import type { EngineContext, EngineRegistry } from "@mcmcjs/engine";
import type { Command } from "commander";
import pc from "picocolors";

export function registerEngines(
  program: Command,
  registry: EngineRegistry,
  ctx: EngineContext,
): void {
  program
    .command("engines")
    .description("List the inference engines mcmc knows about")
    .option("--json", "print the list as JSON")
    .action(async (opts: { json?: boolean }) => {
      const rows = await Promise.all(
        registry.ids().map(async (id) => {
          const engine = registry.get(id);
          const { ready } = await engine.doctor(ctx);
          return {
            id: engine.id,
            displayName: engine.displayName,
            ready,
            capabilities: engine.capabilities,
          };
        }),
      );
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        return;
      }
      for (const row of rows) {
        const status = row.ready ? pc.green("ready") : pc.red("not ready");
        const caps = Object.entries(row.capabilities)
          .filter(([, on]) => on)
          .map(([name]) => name)
          .join(", ");
        process.stdout.write(`${row.id.padEnd(8)} ${status}  ${pc.dim(caps)}\n`);
      }
    });
}
