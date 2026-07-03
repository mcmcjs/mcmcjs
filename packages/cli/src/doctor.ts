import type { EngineContext, EngineRegistry, HealthReport, NamedToolInfo } from "@mcmcjs/engine";
import type { Command } from "commander";
import pc from "picocolors";

export function formatTool(tool: NamedToolInfo): string {
  if (!tool.found) return `${tool.name.padEnd(8)} ${pc.red("not found")}`;
  return `${tool.name.padEnd(8)} ${pc.green(tool.version ?? "found")}  ${pc.dim(tool.path ?? "")}`;
}

/** Renders one engine's health report as a titled section. */
export function formatReport(report: HealthReport, displayName: string): string {
  const lines = [pc.bold(displayName)];
  for (const tool of report.tools) lines.push(formatTool(tool));
  lines.push(
    report.ready
      ? `${pc.green("ready")} for inference`
      : `${pc.red("not ready")}: ${report.hint ?? "toolchain not available"}`,
  );
  return lines.join("\n");
}

export function registerDoctor(
  program: Command,
  registry: EngineRegistry,
  ctx: EngineContext,
): void {
  program
    .command("doctor")
    .summary("report the toolchains mcmc needs")
    .helpGroup("Toolchain:")
    .description("Report the toolchains that mcmc needs for inference, across every engine")
    .option("--engine <id>", "check one engine instead of all")
    .option("--json", "print the report as JSON")
    .action(async (opts: { engine?: string; json?: boolean }) => {
      // Bare `mcmc doctor` reports every registered engine; an inference can
      // run as long as at least one of them is ready.
      const ids = opts.engine ? [registry.resolve(opts.engine).id] : registry.ids();
      const reports = await Promise.all(
        ids.map(async (id) => {
          const engine = registry.get(id);
          return { displayName: engine.displayName, report: await engine.doctor(ctx) };
        }),
      );
      const ready = opts.engine
        ? (reports[0]?.report.ready ?? false)
        : reports.some((r) => r.report.ready);

      if (opts.json) {
        const payload = opts.engine ? reports[0]?.report : reports.map((r) => r.report);
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else if (opts.engine) {
        // Single-engine output keeps the original flat shape.
        const single = reports[0];
        if (single) {
          for (const tool of single.report.tools) {
            process.stdout.write(`${formatTool(tool)}\n`);
          }
          process.stdout.write(
            single.report.ready
              ? `\n${pc.green("ready")} for inference\n`
              : `\n${pc.red("not ready")}: ${single.report.hint ?? "toolchain not available"}\n`,
          );
        }
      } else {
        process.stdout.write(
          `${reports.map((r) => formatReport(r.report, r.displayName)).join("\n\n")}\n`,
        );
      }
      process.exitCode = ready ? 0 : 1;
    });
}
