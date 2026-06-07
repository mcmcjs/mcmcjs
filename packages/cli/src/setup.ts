import { runSetup, type SetupResult } from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";
import { formatTool } from "./doctor";

const JULIAUP_URL = "https://github.com/JuliaLang/juliaup";

/** Renders the outcome of `runSetup` as human-readable terminal output. */
export function formatSetupResult(result: SetupResult, dryRun = false): string {
  const lines: string[] = [];

  for (const step of result.steps) {
    if (step.status === "unsupported") {
      lines.push(`${pc.yellow("skip")}  cannot auto-install ${step.tool} on this platform`);
    } else if (dryRun && step.command) {
      lines.push(`${pc.dim("would")} ${step.label}`);
      lines.push(`      ${pc.dim(`${step.command.command} ${step.command.args.join(" ")}`)}`);
    } else if (step.status === "ran") {
      lines.push(`${pc.green("ok")}    ${step.label}`);
    } else if (step.status === "failed") {
      lines.push(`${pc.red("fail")}  ${step.label}`);
      if (step.detail) lines.push(`      ${pc.dim(step.detail)}`);
    }
  }

  if (result.steps.length === 0) lines.push(pc.dim("toolchain already installed"));

  lines.push("");
  lines.push(formatTool("juliaup", result.juliaup));
  lines.push(formatTool("julia", result.julia));
  lines.push("");
  lines.push(
    result.ready
      ? `${pc.green("ready")} for inference`
      : `${pc.red("not ready")}: Julia not available. See ${JULIAUP_URL}`,
  );

  return lines.join("\n");
}

export function registerSetup(program: Command): void {
  program
    .command("setup")
    .description("Install the Julia toolchain (juliaup and Julia) that mcmc needs for inference")
    .option("--dry-run", "show what would be installed without making changes")
    .option("--json", "print the result as JSON")
    .action(async (opts: { dryRun?: boolean; json?: boolean }) => {
      if (!opts.json && !opts.dryRun) {
        process.stdout.write("Setting up the Julia toolchain (this can take a few minutes)...\n\n");
      }
      const result = await runSetup({ dryRun: opts.dryRun });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatSetupResult(result, opts.dryRun)}\n`);
      }
      process.exit(opts.dryRun || result.ready ? 0 : 1);
    });
}
