import type { EngineContext, EngineRegistry, NamedToolInfo } from "@mcmcjs/engine";
import type { Command } from "commander";
import pc from "picocolors";

export function formatTool(tool: NamedToolInfo): string {
  if (!tool.found) return `${tool.name.padEnd(8)} ${pc.red("not found")}`;
  return `${tool.name.padEnd(8)} ${pc.green(tool.version ?? "found")}  ${pc.dim(tool.path ?? "")}`;
}

export function registerDoctor(
  program: Command,
  registry: EngineRegistry,
  ctx: EngineContext,
): void {
  program
    .command("doctor")
    .summary("report the toolchain mcmc needs")
    .helpGroup("Toolchain:")
    .description("Report the toolchain that mcmc needs for inference")
    .option("--engine <id>", "engine to check")
    .option("--json", "print the report as JSON")
    .action(async (opts: { engine?: string; json?: boolean }) => {
      const report = await registry.resolve(opts.engine).doctor(ctx);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        for (const tool of report.tools) process.stdout.write(`${formatTool(tool)}\n`);
        process.stdout.write(
          report.ready
            ? `\n${pc.green("ready")} for inference\n`
            : `\n${pc.red("not ready")}: ${report.hint ?? "toolchain not available"}\n`,
        );
      }
      process.exitCode = report.ready ? 0 : 1;
    });
}
