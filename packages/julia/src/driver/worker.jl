# MCMC.js persistent fit worker. Keeps Turing loaded between fits so warm
# re-fits skip the cold start. Listens on a Unix domain socket (ARGS[1]); each
# connection carries one JSON request line and receives {"mcmcjs":"progress"}
# lines followed by one final handle_request result line. A {"mcmcjs":"stop"}
# request shuts the worker down; so does half an hour of idleness.
include(joinpath(@__DIR__, "fitlib.jl"))
using Sockets

const IDLE_TIMEOUT_S = 30 * 60

# True while this process still owns the socket path: another worker stealing
# the path (by binding over it) changes the inode, and a worker that lost the
# path must never delete its successor's socket.
function owns_socket(path, ino)
    try
        return stat(path).inode == ino
    catch
        return false
    end
end

function remove_if_owned(path, ino)
    owns_socket(path, ino) && rm(path; force = true)
end

function serve(path)
    mkpath(dirname(path))
    if ispath(path)
        # A live worker already serving this path wins; a dead socket file is cleared.
        try
            close(Sockets.connect(path))
            exit(0)
        catch
            rm(path; force = true)
        end
    end
    server = Sockets.listen(path)
    ino = stat(path).inode
    atexit(() -> remove_if_owned(path, ino))

    last_activity = Ref(time())
    busy = Ref(false)
    # The watchdog task is cooperative: it gets scheduled while the main task
    # blocks on accept. The busy guard is belt and braces for any future
    # multithreaded scheduling.
    @async while true
        sleep(30)
        if !busy[] && time() - last_activity[] > IDLE_TIMEOUT_S
            remove_if_owned(path, ino)
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
            remove_if_owned(path, ino)
            exit(0)
        end
    end
end

serve(ARGS[1])
