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
      const outcomes = [];
      for (const worker of workers) {
        outcomes.push({ socket: worker.socket, outcome: await stopWorker(worker.socket) });
      }
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
        return;
      }
      if (outcomes.length === 0) {
        process.stdout.write("no workers to stop\n");
        return;
      }
      for (const { socket, outcome } of outcomes) {
        const note =
          outcome === "stopped"
            ? pc.green("stopped")
            : outcome === "stale"
              ? pc.dim("removed stale socket")
              : pc.yellow("busy; will exit after the current fit");
        process.stdout.write(`${note}  ${socket}\n`);
      }
    });
}
