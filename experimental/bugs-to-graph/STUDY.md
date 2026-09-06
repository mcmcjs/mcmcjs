# BUGS to graph: what is possible, what blocks it, and where it should live

Everything below is measured on the 50 BUGS examples registered in JuliaBUGS (Volumes 1 to 3) and the 15 graphs bundled with the widget, 12 of which are BUGS examples drawn by hand.
`graph.jl` is the prototype used for the measurements; `viewer.html` shows every generated graph next to its hand-drawn counterpart in the real widget.

## 1. It is possible, and the result matches what a person draws

Generated graphs were diffed against the 12 hand-drawn ones on node names, node types and the edge set.

| Result | Count | Examples |
|---|---:|---|
| Exact structural match | 8 | rats, pumps, dyes, blockers, salm, equiv, oxford, surgical |
| Differs only by an editorial choice | 4 | seeds, epil, mice, kidney |
| Wrong | 0 | |

Rats is identical: 15 nodes, 14 edges, every node type agreeing.
The four that differ do so because a person left something out that the program contains.
Seeds differs only in the plate label, where the hand-drawn files disagree among themselves (`Plate.i` in rats, `Plate i` in seeds).
Mice and kidney include `t.cen`, the censoring bound, which the hand graph omits.
Epil includes the 12 data covariates (`Age`, `Base`, `Trt`, `V4` and their centred forms), which the hand graph omits.
Both omissions are reasonable choices for a picture and should be a toggle, not a fix.

## 2. Why the earlier attempt would have struggled

JuliaBUGS already turns BUGS into a graph; that is what `compile` does.
So the natural first move is to use it.
But that graph is unrolled to array elements: for rats it has 367 vertices (`mu[5, 4]`, `alpha[3]`, `Y[6, 4]`), because every array entry is its own node.
DoodlePPL wants the syntactic graph, one node per variable with `for` loops as plates, which for rats is 9 nodes.
The compiled graph cannot be collapsed back into that without re-deriving the loop structure, and no layout algorithm rescues a 367-node picture.
The source has to be the model text or its AST, where the loops still exist.
That is a plain tree walk and needs no compilation, no data, and no inference.

## 3. Julia or the browser

The prototype is Julia because JuliaBUGS already has a BUGS parser, which made it the fastest way to get evidence.
The product should be in the browser.
The reasons are concrete rather than aesthetic.

**The widget already has the layout engines.**
`doodleppl-ui` ships Cytoscape with dagre, klay, fcose and cola installed and wired (`useGraphLayout.ts`), and Cytoscape's compound nodes are how plates are already drawn (`parent` on a node).
Klay is derived from ELK and handles compound hierarchies natively, which is exactly the plate-nesting case.
The Julia prototype had to invent a layered layout because it has none of this; in the browser that code is deleted.

**The original text is the ground truth, and JuliaBUGS rewrites it.**
JuliaBUGS's string parser turns `T(l, u)` into `truncated(...)`, `C(l, u)` into `censored(...)`, `step(x)` into `_step(x)`, and `logit(p) <- e` into `p = logistic(e)` (`bugs_parser.jl:493`, `JuliaBUGS.jl:599`).
A Julia-side generator has to undo each of these to produce a faithful graph, and the prototype's `UNDO_REWRITES` table is exactly that maintenance burden.
A browser parser reads the program the user wrote.

**It becomes a feature, not a build step.**
Parsing in the widget means "paste a BUGS model, see its graph" for every user, and the BUGS examples become one consumer of it rather than the reason it exists.
The same TypeScript runs under Node at build time to regenerate the bundled JSONs, so the docs pipeline needs no Julia.

**It is testable against something that already exists.**
The widget's codegen goes graph to BUGS.
A parser going BUGS to graph gives a round trip, and the 15 bundled graphs plus the 50 example programs are an oracle: `parse(codegen(G))` must be isomorphic to `G`, and `codegen(parse(P))` must re-parse to the same graph as `P`.

**Nothing exists to reuse.**
npm has no BUGS parser (`bugs-parser`, `bugs-lang`, `openbugs`, `winbugs`, `jags-parser` are all unclaimed; `doodlebugs@0.0.1` is the widget's own predecessor).
The doodleppl core has `parseIndexedRef` and three regexes in `discrete-analysis.ts`, which extract identifiers but do not parse expressions.
The grammar is small enough that this is fine.

### What the parser has to handle

The BUGS surface is: a `model { }` block, `for (v in a:b) { }`, `x ~ dist(args)`, `x <- expr`, a link function on the left (`logit(p[i]) <- expr`), subscripts with ranges and an empty slot meaning "all" (`Y[i, ]`), function calls, arithmetic with the usual precedence, unary minus, numbers such as `1.0E-6`, identifiers containing dots, `#` comments, optional `;`, and the modifiers `C(l, u)`, `T(l, u)` and legacy `I(l, u)`.
`true` and `false` are ordinary identifiers (biopsies has a variable named `true`).
A recursive-descent parser for this is a few hundred lines; JuliaBUGS's `bugs_parser.jl` is a complete reference grammar.

Two mappings are needed to land in the existing schema, both already implied by the hand-drawn files.
A link on the left becomes the inverse link on the right: seeds stores `logit(p[i]) <- e` as `equation: "ilogit(e)"`, so the parser applies `logit` to `ilogit`, `log` to `exp`, `cloglog` to `icloglog`, `probit` to `phi`.
`C(l, u)` fills `censorLower` and `censorUpper`, which kidney already uses.
There is no field for `T(l, u)`; truncation needs two new optional fields or it is silently lost.
`I(l, u)` is WinBUGS's older spelling with the same meaning as `C` in most programs, and should be treated as `C` with a warning.

## 4. The three complexities, each taken apart

### 4.1 Hybrid nodes: 14 examples, but three different things

A variable that appears on the left of both `<-` and `~`.
Dumping every such statement shows this is not one phenomenon.

**A. The value is fixed by an equation and then given a likelihood (11 examples).**
Dogs: `y[i, j] <- 1 - Y[i, j]` then `y[i, j] ~ dbern(p[i, j])`.
The same idiom is lsat (`r`), leuk and leukfr (`dN`), magnesium (`rcx`, `rtx`), bayes_factors (`Ys`), endo (`Y`), and the five Volume 3 shapes (`O <- 1; O ~ dbern(constraint)`, the ones trick).
In every case the variable is a transformation of data and the `~` is its likelihood, so semantically it is an observed node whose value comes from a formula.
This is exactly [JuliaBUGS issue #419](https://github.com/TuringLang/JuliaBUGS.jl/issues/419), and the schema already allows it: `codegen/bugs.ts:94` emits the `<-` line before the `~` line whenever a stochastic or observed node has an `equation`.
What remains is that the editor's validation still treats a node as one or the other, and the generator now emits these as `observed` nodes carrying both fields.
Nothing new is needed in the document format.

**B. Different elements of one array get different treatment: corner constraints (2 examples).**
Alligators: `alpha[1] <- 0` and `alpha[k] ~ dnorm(0, 1.0E-5)` for `k` in `2:K`, and the same for the first row and column of `beta` and `gamma`.
Eyes: `lambda[1] ~ dnorm(...)` and `lambda[2] <- lambda[1] + theta`, an ordering constraint.
No element is both deterministic and stochastic, so nothing about a DAG is violated.
The only problem is that a node stood for a whole variable.
The fix is to key nodes on the pair (variable, subscript pattern) rather than the variable alone, which gives an `alpha[1]` node and an `alpha[k]` node inside the plate, and is how a statistician draws it.
The prototype now does this; the schema already has `indices`.

**C. Six models in one (1 example).**
Magnesium fits six alternative priors by writing six explicit statements per parameter, some `~` and some `<-`, with no loop.
Pattern-keyed nodes handle it faithfully at the cost of 18 nodes for three variables.
It is a pathological model for any graph and is better left out of the gallery than special-cased.

The proposal in #419 is right for A.
For B and C it would be the wrong tool: splitting is stricter and loses nothing.

### 4.2 Computed indices: 18 examples, and only 7 need anything

Any subscript that is not a bare name, integer or simple range.
Again the cases separate.

**I. Lookup through another variable (11 examples).**
`beta.dis[disease[i]]`, `lambda[T[i]]`, `alpha[school[p], 1]`, `b[pair[i]]`, `sign[T[i, k]]`, `error[true[i], ]`, `P[state1[i]]`, `phi[x1[i], d1[i]]`, `beta[J[i]]`, `theta[S[i]]`, `p[i, j, ncat[j]]`.
The node depends on both the indexed array and the index variable, and both are ordinary edges.
The parameter string carries the whole expression, so codegen reproduces it verbatim.
Whether the index is data (`disease`, `school`, `pair`) or latent (`true` in biopsies, `S` in eye_tracking, `state1` in hearts, the mixture and latent-class models) changes nothing about the graph.
No schema change is needed.
What is lost is only the visual hint that a parent is used as an index; if wanted, `relationshipType` on the edge could grow an `index` value and be drawn dashed.
WinBUGS's Doodle could not express these at all, which is why no doodles exist for them.

**II. An offset on the loop variable into a different variable (6 examples).**
`t[j + 1]`, `culm[i - 1]`, `Q[i, j, k - 1]`, `T[j, j + 1]`, `1:j - 1`, `1:ncat[j]`.
An ordinary edge from that variable.
Nothing needed.

**III. A node that refers to itself at another index (7 examples).**
Measured directly by asking whether a statement's right side mentions its own left-side variable: eyes (`lambda`), eye_tracking (`p`), hips1, hips3, hips4 (`pi`, and `h`), pig_weights (`T`), bayes_factors (`p`).
These are Markov chains, stick-breaking constructions and ordering constraints.
The honest representation is a self-edge labelled as a lag, which is standard in modern graphical-model notation and which Cytoscape draws as a loop without help.
Two things have to change for it to work end to end.
`topo-sort.ts` drops the nodes of any cycle, so a self-edge would silently remove the node from generated code; the sort must ignore edges whose source equals their target, since they carry no ordering information.
And the editor's cycle validation must allow that one shape.
The generator keeps these edges.

So the earlier statement that a computed index has "nowhere to go in the schema" was wrong.
Eleven need nothing, six need nothing, and seven need a self-edge that is a small, well-defined change.

### 4.3 Plate depth beyond two: 7 examples, a layout question only

lsat, bones, alligators, hips1, hips2 and hips3 nest three deep; hips4 nests four deep.
The schema's `parent` is recursive, the codegen's `generate` is recursive (`bugs.ts:61`), and [issue #351](https://github.com/TuringLang/JuliaBUGS.jl/issues/351) closed nested plates as supported.
The only real question is whether the picture is readable, and klay's compound layout is built for this.
hips4 has 50 nodes and will be dense at any depth; that is a reason to leave it out of the gallery, not a limitation of the approach.

## 5. What stays out of reach

Seven examples are not registered at all, for reasons unrelated to graphs: `expr`, `dloglik` and `interp.lin` are not allowed functions, Camel has a partially observed multivariate node, Inhalers compiles to a cyclic graph, and two source files are empty.
Nothing here changes that.

## 6. Recommendation

Build the parser in TypeScript inside `@mcmcjs/doodleppl`, with the codegen as its round-trip test partner and the 50 example programs plus 15 bundled graphs as fixtures.
Keep `graph.jl` only until the TypeScript parser reproduces its output, then delete it.
Make three small schema-adjacent changes: ignore self-edges in `topo-sort.ts`, permit them in editor validation with a lag label, and add optional truncation fields for `T(l, u)`.
Key nodes on (variable, subscript pattern) in the parser, which resolves patterns B and C with no schema change.
Let the editor accept an `equation` on stochastic and observed nodes, which is the codegen's existing behaviour and closes #419 for pattern A.
Generate the bundled JSONs from the parser under Node at build time, and add "import BUGS" to the widget as the user-facing surface.
Offer a "hide constants" toggle so epil-style graphs can match the hand-drawn convention when wanted.

With that, 43 of 50 examples draw cleanly, magnesium and hips4 are excluded on readability, and the remaining 5 (lsat, bones, alligators, hips1, hips2, hips3 minus the excluded) depend only on how the compound layout looks.
