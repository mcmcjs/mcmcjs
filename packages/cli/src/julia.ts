import {
  type CommandRunner,
  createRunner,
  createStreamingRunner,
  type EngineContext,
  type RuntimeVersion,
} from "@mcmcjs/engine";
import {
  addVersion,
  detectJuliaup,
  gcVersions,
  listVersions,
  removeVersion,
  runDoctor,
  setDefaultVersion,
  updateVersion,
} from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";
import { formatTool } from "./doctor";
import { createCollapsingRunner } from "./install-progress";

const INSTALL_TIMEOUT_MS = 15 * 60_000;

export interface InstallRunnerOpts {
  /** A short description of the work, shown by the spinner / header. */
  label: string;
  timeoutMs: number;
  /** Buffered and silent (for machine output). */
  json?: boolean;
  /** Stream the full raw subprocess output instead of collapsing it. */
  verbose?: boolean;
}

/**
 * The runner for a long install/provision step. Default: a collapsing spinner
 * that erases itself when done (no firehose). --verbose: the full raw stream.
 * --json: buffered and silent so machine output stays byte-stable.
 */
export function installRunner(opts: InstallRunnerOpts): CommandRunner {
  if (opts.json) return createRunner(opts.timeoutMs);
  if (opts.verbose) {
    const stream = createStreamingRunner(opts.timeoutMs);
    return (command, args) => {
      process.stderr.write(`${opts.label} (live output)...\n`);
      return stream(command, args);
    };
  }
  return createCollapsingRunner({ label: opts.label, timeoutMs: opts.timeoutMs });
}

/** Renders installed Julia versions, marking the default with an asterisk. */
export function formatVersions(versions: RuntimeVersion[]): string {
  if (versions.length === 0) {
    return "no Julia versions installed. Add one with: mcmc julia version add release";
  }
  return versions
    .map((v) => {
      const marker = v.isDefault ? pc.green("*") : " ";
      return `${marker} ${v.id.padEnd(10)} ${(v.version ?? "").padEnd(10)} ${pc.dim(v.path ?? "")}`;
    })
    .join("\n");
}

export async function juliaupBin(ctx: EngineContext): Promise<string> {
  const info = await detectJuliaup(ctx.run);
  if (!info.found || !info.path) {
    throw new Error("juliaup not found. Run `mcmc setup` to install the Julia toolchain.");
  }
  return info.path;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function registerJulia(program: Command, ctx: EngineContext): void {
  // The read-only status view, shared by bare `mcmc julia`, `julia version`
  // (the default), and `julia version status` so all show the same thing.
  const printStatus = async (json?: boolean): Promise<void> => {
    const bin = await juliaupBin(ctx);
    const [versions, report] = await Promise.all([listVersions(bin, ctx.run), runDoctor(ctx.run)]);
    if (json) {
      printJson({ versions, juliaup: report.juliaup, julia: report.julia, ready: report.ready });
      return;
    }
    process.stdout.write(`${formatTool({ name: "juliaup", ...report.juliaup })}\n`);
    process.stdout.write(`${formatTool({ name: "julia", ...report.julia })}\n\n`);
    process.stdout.write(`${formatVersions(versions)}\n`);
  };

  const julia = program
    .command("julia")
    .summary("manage the Julia runtime")
    .helpGroup("Toolchain:")
    .description("Manage the Julia runtime");
  // `version` is julia's default and `status` is version's default, so bare
  // `mcmc julia` and `mcmc julia version` show the status and exit 0, matching
  // `mcmc runs`/`mcmc daemon`. No --json/action on the julia parent: a parent
  // option would be consumed there and swallow --json from every subcommand.
  const version = julia
    .command("version", { isDefault: true })
    .description("Manage installed Julia versions (via juliaup)");

  version
    .command("list")
    .description("List installed Julia versions")
    .option("--json", "print as JSON")
    .action(async (opts: { json?: boolean }) => {
      const versions = await listVersions(await juliaupBin(ctx), ctx.run);
      if (opts.json) printJson(versions);
      else process.stdout.write(`${formatVersions(versions)}\n`);
    });

  version
    .command("status", { isDefault: true })
    .description("Show installed versions plus the juliaup and Julia toolchain")
    .option("--json", "print as JSON")
    .action((opts: { json?: boolean }) => printStatus(opts.json));

  const reportAfter = async (bin: string, label: string, json?: boolean): Promise<void> => {
    const versions = await listVersions(bin, ctx.run);
    if (json) printJson(versions);
    else process.stdout.write(`${label}\n\n${formatVersions(versions)}\n`);
  };

  version
    .command("add <version>")
    .description("Install a Julia version or channel, e.g. 1.10 or release")
    .option("--default", "also set it as the default")
    .option("--verbose", "show the full raw juliaup output")
    .option("--json", "print as JSON")
    .action(
      async (channel: string, opts: { default?: boolean; verbose?: boolean; json?: boolean }) => {
        const bin = await juliaupBin(ctx);
        const run = installRunner({
          label: `installing Julia ${channel}`,
          timeoutMs: INSTALL_TIMEOUT_MS,
          json: opts.json,
          verbose: opts.verbose,
        });
        await addVersion(bin, channel, { default: opts.default }, run);
        await reportAfter(bin, `${pc.green("added")} ${channel}`, opts.json);
      },
    );

  version
    .command("remove <version>")
    .description("Uninstall a Julia version or channel")
    .option("--verbose", "show the full raw juliaup output")
    .option("--json", "print as JSON")
    .action(async (channel: string, opts: { verbose?: boolean; json?: boolean }) => {
      const bin = await juliaupBin(ctx);
      const run = installRunner({
        label: `removing Julia ${channel}`,
        timeoutMs: INSTALL_TIMEOUT_MS,
        json: opts.json,
        verbose: opts.verbose,
      });
      await removeVersion(bin, channel, run);
      await reportAfter(bin, `${pc.green("removed")} ${channel}`, opts.json);
    });

  version
    .command("default <version>")
    .description("Set the default Julia version or channel")
    .option("--json", "print as JSON")
    .action(async (channel: string, opts: { json?: boolean }) => {
      const bin = await juliaupBin(ctx);
      await setDefaultVersion(bin, channel, ctx.run);
      await reportAfter(bin, `${pc.green("default")} ${channel}`, opts.json);
    });

  version
    .command("update [version]")
    .description("Update one channel, or all installed channels")
    .option("--verbose", "show the full raw juliaup output")
    .option("--json", "print as JSON")
    .action(async (channel: string | undefined, opts: { verbose?: boolean; json?: boolean }) => {
      const bin = await juliaupBin(ctx);
      const run = installRunner({
        label: "updating Julia",
        timeoutMs: INSTALL_TIMEOUT_MS,
        json: opts.json,
        verbose: opts.verbose,
      });
      await updateVersion(bin, channel, run);
      await reportAfter(bin, pc.green("updated"), opts.json);
    });

  version
    .command("gc")
    .description("Reclaim disk from uninstalled Julia versions")
    .option("--verbose", "show the full raw juliaup output")
    .option("--json", "print as JSON")
    .action(async (opts: { verbose?: boolean; json?: boolean }) => {
      const bin = await juliaupBin(ctx);
      const run = installRunner({
        label: "reclaiming disk",
        timeoutMs: INSTALL_TIMEOUT_MS,
        json: opts.json,
        verbose: opts.verbose,
      });
      await gcVersions(bin, run);
      await reportAfter(bin, pc.green("collected"), opts.json);
    });
}
