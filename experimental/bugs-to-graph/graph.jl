using JuliaBUGS
using JSON

const OUT = joinpath(@__DIR__, "out")

# JuliaBUGS's string parser rewrites some BUGS syntax on the way in; undo that so
# the graph carries what the original program said.
const UNDO_REWRITES = ("_step(" => "step(", "logistic(" => "ilogit(",
                       r"var\"([^\"]+)\"" => s"\1")

render(x::Symbol) = replace(String(x), UNDO_REWRITES...)
render(x::Expr) = replace(string(x), UNDO_REWRITES...)
render(x) = string(x)

base(x) = x isa Symbol ? x : (Meta.isexpr(x, :ref) ? base(x.args[1]) : nothing)

"Variables referenced anywhere in an expression, ignoring called functions."
# Syntax rather than variables: the range operator, and the empty slot that BUGS
# censoring writes as `C(l, )`.
const NOT_A_VARIABLE = Set([:(:), :nothing, :missing, :Colon])

function referenced(e, loopvars)
    out = Symbol[]
    walk(x) = begin
        if x isa Symbol
            x in loopvars || x in NOT_A_VARIABLE || push!(out, x)
        elseif Meta.isexpr(x, :ref)
            b = base(x)
            b !== nothing && !(b in loopvars) && push!(out, b)
            foreach(walk, x.args[2:end])
        elseif Meta.isexpr(x, :call)
            foreach(walk, x.args[2:end])
        elseif x isa Expr
            foreach(walk, x.args)
        end
    end
    walk(e)
    return unique(out)
end

struct Stmt
    var::Symbol
    kind::Symbol
    lhs::Any
    rhs::Any
    loopvars::Vector{Symbol}
    plate::Union{Nothing,String}
end

# The subscript pattern on the left-hand side, e.g. "1" or "i, k". Two statements
# with the same variable but different patterns (alpha[1] <- 0; alpha[k] ~ ...)
# are different nodes, which is how corner constraints get drawn.
pattern(s::Stmt) = Meta.isexpr(s.lhs, :ref) ? join(render.(s.lhs.args[2:end]), ", ") : ""

"Walk the model, collecting one Stmt per assignment and one plate per `for`."
function scan(expr)
    stmts = Stmt[]
    plates = Vector{NamedTuple}()
    walk(e, loopvars, plate) = begin
        if Meta.isexpr(e, :for)
            spec = e.args[1]
            v = spec.args[1]::Symbol
            id = "plate_$(render(v))"
            any(p -> p.id == id, plates) ||
                push!(plates, (; id, var = render(v), range = render(spec.args[2]), parent = plate))
            walk(e.args[2], vcat(loopvars, v), id)
        elseif Meta.isexpr(e, :block)
            foreach(a -> walk(a, loopvars, plate), e.args)
        elseif Meta.isexpr(e, :(=))
            b = base(e.args[1])
            b !== nothing &&
                push!(stmts, Stmt(b, :logical, e.args[1], e.args[2], loopvars, plate))
        elseif Meta.isexpr(e, :call) && length(e.args) == 3 && e.args[1] === :~
            b = base(e.args[2])
            b !== nothing &&
                push!(stmts, Stmt(b, :stochastic, e.args[2], e.args[3], loopvars, plate))
        end
    end
    walk(expr, Symbol[], nothing)
    return stmts, plates
end

"""
Layered positions: layer = longest path from a root, then spread within the layer.
"""
function layout(ids, edges)
    parents = Dict(id => String[] for id in ids)
    for (s, t) in edges
        haskey(parents, t) && s in ids && push!(parents[t], s)
    end
    layer = Dict{String,Int}()
    function depth(id, seen = Set{String}())
        haskey(layer, id) && return layer[id]
        id in seen && return 0
        push!(seen, id)
        d = isempty(parents[id]) ? 0 : 1 + maximum(depth(p, seen) for p in parents[id])
        return layer[id] = d
    end
    foreach(depth, ids)
    perlayer = Dict{Int,Int}()
    pos = Dict{String,NamedTuple{(:x, :y),Tuple{Float64,Float64}}}()
    for id in sort(ids; by = i -> (layer[i], i))
        l = layer[id]
        col = get(perlayer, l, 0)
        perlayer[l] = col + 1
        pos[id] = (x = 120.0 + 180col, y = 80.0 + 130l)
    end
    return pos
end

function to_document(name, example)
    stmts, plates = scan(example.model_def)
    datakeys = Set(keys(example.data))

    kinds = Dict{Symbol,Set{Symbol}}()
    for s in stmts
        push!(get!(kinds, s.var, Set{Symbol}()), s.kind)
    end
    hybrid = Set(v for (v, ks) in kinds if length(ks) > 1)

    assigned = Set(s.var for s in stmts)
    constants = Symbol[]
    for s in stmts, r in referenced(s.rhs, s.loopvars)
        r in assigned || r in constants || push!(constants, r)
    end

    elements = Any[]
    for p in plates
        plate = Dict{String,Any}("id" => p.id, "name" => "Plate.$(p.var)", "type" => "node",
                                 "nodeType" => "plate", "position" => Dict("x" => 0, "y" => 0),
                                 "loopVariable" => p.var, "loopRange" => p.range)
        p.parent === nothing || (plate["parent"] = p.parent)
        push!(elements, plate)
    end

    # One node per (variable, subscript pattern). The first pattern seen for a
    # variable keeps the plain id, so edges from elsewhere have a stable target.
    groups = Dict{Tuple{Symbol,String},Vector{Stmt}}()
    order = Tuple{Symbol,String}[]
    for s in stmts
        key = (s.var, pattern(s))
        haskey(groups, key) || (push!(order, key); groups[key] = Stmt[])
        push!(groups[key], s)
    end
    primary = Dict{Symbol,String}()
    node_of = Dict{Tuple{Symbol,String},String}()
    ids = String[]
    for key in order
        (var, pat) = key
        id = haskey(primary, var) ? "node_$(render(var))_$(count(k -> k[1] == var, order[1:findfirst(==(key), order)]))" :
             "node_$(render(var))"
        haskey(primary, var) || (primary[var] = id)
        node_of[key] = id
        push!(ids, id)

        ss = groups[key]
        sto = findfirst(s -> s.kind === :stochastic, ss)
        det = findfirst(s -> s.kind === :logical, ss)
        # Both on one pattern is the data-transform-then-likelihood idiom (#419):
        # the value is fixed by the equation, the ~ is its likelihood.
        nodetype = sto === nothing ? "deterministic" :
                   (det !== nothing || var in datakeys) ? "observed" : "stochastic"
        node = Dict{String,Any}("id" => id, "name" => render(var), "type" => "node",
                                "nodeType" => nodetype,
                                "position" => Dict("x" => 0, "y" => 0))
        nodetype == "observed" && (node["observed"] = true)
        first(ss).plate === nothing || (node["parent"] = first(ss).plate)
        isempty(pat) || (node["indices"] = pat)
        if sto !== nothing && Meta.isexpr(ss[sto].rhs, :call)
            call = ss[sto].rhs
            node["distribution"] = render(call.args[1])
            length(call.args) > 1 && (node["param1"] = render(call.args[2]))
            length(call.args) > 2 && (node["param2"] = render(call.args[3]))
            length(call.args) > 3 && (node["param3"] = render(call.args[4]))
        end
        det === nothing || (node["equation"] = render(ss[det].rhs))
        push!(elements, node)
    end
    for c in constants
        id = "node_$(render(c))"
        primary[c] = id
        push!(ids, id)
        push!(elements, Dict("id" => id, "name" => render(c), "type" => "node",
                             "nodeType" => "constant", "position" => Dict("x" => 0, "y" => 0)))
    end

    # A node that mentions itself (pi[k, t, :] from pi[k, t - 1, :]) keeps the
    # self-edge; it is a lag, not a cycle, and Cytoscape draws it as a loop.
    edges = Tuple{String,String}[]
    for s in stmts, r in referenced(s.rhs, s.loopvars)
        haskey(primary, r) || continue
        push!(edges, (primary[r], node_of[(s.var, pattern(s))]))
    end
    edges = unique(edges)

    pos = layout(ids, edges)
    for el in elements
        haskey(pos, el["id"]) || continue
        el["position"] = Dict("x" => pos[el["id"]].x, "y" => pos[el["id"]].y)
    end
    for p in plates
        kids = [e for e in elements if get(e, "parent", nothing) == p.id]
        idx = findfirst(e -> e["id"] == p.id, elements)
        isempty(kids) || (elements[idx]["position"] = Dict(
            "x" => sum(k["position"]["x"] for k in kids) / length(kids),
            "y" => sum(k["position"]["y"] for k in kids) / length(kids) + 60))
    end

    for (s, t) in edges
        push!(elements, Dict("id" => "edge_$(s)_to_$(t)", "type" => "edge",
                             "source" => s, "target" => t))
    end

    return Dict("name" => example.name, "version" => 1, "elements" => elements,
                "dataContent" => JSON.json(Dict("data" => example.data), 2)),
           (; hybrid = collect(hybrid), nodes = length(ids), edges = length(edges))
end

function main(argv)
    mkpath(OUT)
    E = JuliaBUGS.BUGSExamples
    wanted = Set(Symbol.(argv))
    ok, skipped = 0, String[]
    for vol in (:VOLUME_1, :VOLUME_2, :VOLUME_3)
        reg = getproperty(E, vol)
        for k in keys(reg)
            isempty(wanted) || k in wanted || continue
            try
                doc, info = to_document(String(k), getproperty(reg, k))
                write(joinpath(OUT, "$(k).json"), JSON.json(doc, 2))
                flag = isempty(info.hybrid) ? "" : "  hybrid: $(join(info.hybrid, ", "))"
                println(rpad(String(k), 22), "nodes=", rpad(info.nodes, 4),
                        "edges=", rpad(info.edges, 4), flag)
                ok += 1
            catch err
                push!(skipped, "$k: $(sprint(showerror, err))")
            end
        end
    end
    println("\nwrote $ok documents to $OUT")
    isempty(skipped) || (println("failed:"); foreach(s -> println("  ", s), skipped))
end

main(ARGS)
