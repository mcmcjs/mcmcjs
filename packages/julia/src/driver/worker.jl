# MCMC.js persistent fit worker. Keeps Turing loaded between fits so warm
# re-fits skip the cold start. Listens on a Unix domain socket (ARGS[1]); each
# connection carries one JSON request line and receives {"mcmcjs":"progress"}
# lines followed by one final handle_request result line. A {"mcmcjs":"stop"}
# request shuts the worker down; so does half an hour of idleness.
include(joinpath(@__DIR__, "fitlib.jl"))
using Sockets

const IDLE_TIMEOUT_S = 30 * 60

function serve(path)
    mkpath(dirname(path))
    rm(path; force = true)
    server = Sockets.listen(path)
    atexit(() -> rm(path; force = true))

    last_activity = Ref(time())
    busy = Ref(false)
    # Cooperative watchdog: it only runs while the main task is blocked on
    # accept, and the busy guard keeps a long fit safe regardless.
    @async while true
        sleep(30)
        if !busy[] && time() - last_activity[] > IDLE_TIMEOUT_S
            rm(path; force = true)
            exit(0)
        end
    end

    while true
        sock = Sockets.accept(server)
        busy[] = true
        stopping = false
        try
            line = readline(sock)
            if isempty(strip(line))
                close(sock)
                continue
            end
            request = JSON.parse(line)
            if get(request, "mcmcjs", "") == "stop"
                stopping = true
                println(sock, JSON.json(Dict("ok" => true, "stopped" => true)))
            else
                PROGRESS_IO[] = sock
                result = try
                    handle_request(request)
                finally
                    PROGRESS_IO[] = stderr
                end
                println(sock, JSON.json(result))
            end
            close(sock)
        catch err
            try
                println(sock, JSON.json(Dict("ok" => false, "error" => sprint(showerror, err), "stage" => "worker")))
                close(sock)
            catch
            end
        finally
            busy[] = false
            last_activity[] = time()
        end
        if stopping
            rm(path; force = true)
            exit(0)
        end
    end
end

serve(ARGS[1])
