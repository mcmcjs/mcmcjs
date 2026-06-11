# MCMC.js one-shot fit driver. Reads a run-request JSON file and runs it via
# fitlib's handle_request. On success a single line of provenance JSON is
# printed to stdout; failures print one-line JSON to stderr ({error, stage})
# and exit nonzero. Progress streams to stderr as {"mcmcjs":"progress"} lines.
include(joinpath(@__DIR__, "fitlib.jl"))

function main()
    request = JSON.parsefile(ARGS[1])
    result = handle_request(request)
    if result["ok"]
        println(JSON.json(result["provenance"]))
    else
        println(stderr, JSON.json(Dict("error" => result["error"], "stage" => result["stage"])))
        exit(1)
    end
end

main()
