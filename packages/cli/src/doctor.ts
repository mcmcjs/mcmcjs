import { runDoctor, type ToolInfo } from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";

export function formatTool(label: string, info: ToolInfo): string {
  if (!info.found) return `${label.padEnd(8)} ${pc.red("not found")}`;
  return `${label.padEnd(8)} ${pc.green(info.version ?? "found")}  ${pc.dim(info.path ?? "")}`;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Report the Julia toolchain that mcmc needs for inference")
    .option("--json", "print the report as JSON")
    .action(async (opts: { json?: boolean }) => {
      const report = await runDoctor();
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatTool("juliaup", report.juliaup)}\n`);
        process.stdout.write(`${formatTool("julia", report.julia)}\n\n`);
        process.stdout.write(
          report.ready
            ? `${pc.green("ready")} for inference\n`
            : `${pc.red("not ready")}: Julia not found. Install it with juliaup (https://github.com/JuliaLang/juliaup).\n`,
        );
      }
      process.exit(report.ready ? 0 : 1);
    });
}
