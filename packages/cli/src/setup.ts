import { runSetup, type SetupResult } from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";
import { formatTool } from "./doctor";
import { installRunner } from "./julia";

const JULIAUP_URL = "https://github.com/JuliaLang/juliaup";
const INSTALL_TIMEOUT_MS = 15 * 60_000;

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
  lines.push(formatTool({ name: "juliaup", ...result.juliaup }));
  lines.push(formatTool({ name: "julia", ...result.julia }));
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
    .option("--verbose", "show the full raw install output instead of a collapsed spinner")
    .option("--json", "print the result as JSON")
    .action(async (opts: { dryRun?: boolean; verbose?: boolean; json?: boolean }) => {
      const result = await runSetup({
        dryRun: opts.dryRun,
        installer: installRunner({
          label: "setting up the Julia toolchain",
          timeoutMs: INSTALL_TIMEOUT_MS,
          json: opts.json,
          verbose: opts.verbose,
        }),
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatSetupResult(result, opts.dryRun)}\n`);
      }
      process.exitCode = opts.dryRun || result.ready ? 0 : 1;
    });
}
