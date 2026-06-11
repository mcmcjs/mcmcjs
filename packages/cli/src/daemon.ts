import { listWorkers, stopWorker } from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";

export function registerDaemon(program: Command): void {
  const daemon = program
    .command("daemon")
    .description("Manage the persistent Julia workers behind --daemon runs");

  daemon
    .command("status", { isDefault: true })
    .description("List known workers and whether they answer")
    .option("--json", "print the worker list as JSON")
    .action(async (opts: { json?: boolean }) => {
      const workers = await listWorkers();
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(workers, null, 2)}\n`);
        return;
      }
      if (workers.length === 0) {
        process.stdout.write("no workers; start one with `mcmc run <model> --daemon`\n");
        return;
      }
      for (const worker of workers) {
        const state = worker.alive ? pc.green("alive") : pc.dim("stale");
        process.stdout.write(`${state}  ${worker.socket}\n`);
      }
    });

  daemon
    .command("stop")
    .description("Stop all workers and remove their sockets")
    .option("--json", "print the result as JSON")
    .action(async (opts: { json?: boolean }) => {
      const workers = await listWorkers();
      const stopped: string[] = [];
      for (const worker of workers) {
        if (await stopWorker(worker.socket)) stopped.push(worker.socket);
      }
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ stopped, removed: workers.length }, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        workers.length === 0
          ? "no workers to stop\n"
          : `stopped ${stopped.length} worker${stopped.length === 1 ? "" : "s"}, removed ${workers.length} socket${workers.length === 1 ? "" : "s"}\n`,
      );
    });
}
