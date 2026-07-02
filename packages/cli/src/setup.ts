import { runSetup, type SetupResult } from "@mcmcjs/julia";
import { runSetup as runStanSetup, type StanSetupResult } from "@mcmcjs/stan";
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

/** Renders the outcome of the Stan `runSetup` as human-readable terminal output. */
export function formatStanSetupResult(result: StanSetupResult, dryRun = false): string {
  const lines: string[] = [];

  for (const step of result.steps) {
    if (step.status === "unsupported") {
      lines.push(`${pc.yellow("todo")}  ${step.label}`);
    } else if (dryRun && step.command) {
      lines.push(`${pc.dim("would")} ${step.label}`);
      lines.push(`      ${pc.dim(`${step.command.command} ${step.command.args.join(" ")}`)}`);
    } else if (step.status === "ran") {
      lines.push(`${pc.green("ok")}    ${step.label}`);
    } else if (step.status === "skipped" && !dryRun) {
      lines.push(`${pc.yellow("skip")}  ${step.label}`);
    } else if (step.status === "failed") {
      lines.push(`${pc.red("fail")}  ${step.label}`);
      if (step.detail) lines.push(`      ${pc.dim(step.detail)}`);
    }
  }

  if (result.steps.length === 0) lines.push(pc.dim("toolchain already installed"));

  lines.push("");
  lines.push(formatTool({ name: "cmdstan", ...result.cmdstan }));
  lines.push(formatTool({ name: "stanc", ...result.stanc }));
  lines.push(formatTool({ name: "make", ...result.make }));
  lines.push(formatTool({ name: "c++", ...result.cxx }));
  lines.push("");
  lines.push(
    result.ready
      ? `${pc.green("ready")} for inference`
      : `${pc.red("not ready")}: CmdStan or the build toolchain is missing`,
  );

  return lines.join("\n");
}

export function registerSetup(program: Command): void {
  program
    .command("setup")
    .summary("install an inference toolchain (Julia or Stan)")
    .helpGroup("Toolchain:")
    .description("Install the toolchain an engine needs: Julia (juliaup) or Stan (CmdStan)")
    .option("--engine <id>", "toolchain to install: julia or stan", "julia")
    .option("--stan-version <version>", "CmdStan version to install (with --engine stan)")
    .option("--dry-run", "show what would be installed without making changes")
    .option("--verbose", "show the full raw install output instead of a collapsed spinner")
    .option("--json", "print the result as JSON")
    .action(
      async (opts: {
        engine?: string;
        stanVersion?: string;
        dryRun?: boolean;
        verbose?: boolean;
        json?: boolean;
      }) => {
        if (opts.engine && opts.engine !== "julia" && opts.engine !== "stan") {
          throw new Error(`unknown engine for setup: ${opts.engine} (expected julia or stan)`);
        }
        if (opts.stanVersion && opts.engine !== "stan") {
          throw new Error("--stan-version applies to --engine stan");
        }
        if (opts.engine === "stan") {
          const result = await runStanSetup({
            dryRun: opts.dryRun,
            version: opts.stanVersion,
            installer: installRunner({
              label: "setting up the Stan toolchain",
              timeoutMs: 2 * INSTALL_TIMEOUT_MS,
              json: opts.json,
              verbose: opts.verbose,
            }),
          });
          if (opts.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          } else {
            process.stdout.write(`${formatStanSetupResult(result, opts.dryRun)}\n`);
          }
          process.exitCode = opts.dryRun || result.ready ? 0 : 1;
          return;
        }
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
      },
    );
}
