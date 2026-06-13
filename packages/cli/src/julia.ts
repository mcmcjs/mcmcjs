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

const INSTALL_TIMEOUT_MS = 15 * 60_000;

/**
 * The runner for a long install/provision step: streams the subprocess's native
 * output live to stderr in human mode, stays buffered (silent) under --json so
 * machine output is byte-stable.
 */
export function installRunner(json: boolean | undefined, timeoutMs: number): CommandRunner {
  return json ? createRunner(timeoutMs) : createStreamingRunner(timeoutMs);
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
  const install = createRunner(INSTALL_TIMEOUT_MS);
  const julia = program.command("julia").description("Manage the Julia runtime");
  const version = julia
    .command("version")
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
    .command("status")
    .description("Show installed versions plus the juliaup and Julia toolchain")
    .option("--json", "print as JSON")
    .action(async (opts: { json?: boolean }) => {
      const bin = await juliaupBin(ctx);
      const [versions, report] = await Promise.all([
        listVersions(bin, ctx.run),
        runDoctor(ctx.run),
      ]);
      if (opts.json) {
        printJson({ versions, juliaup: report.juliaup, julia: report.julia, ready: report.ready });
        return;
      }
      process.stdout.write(`${formatTool({ name: "juliaup", ...report.juliaup })}\n`);
      process.stdout.write(`${formatTool({ name: "julia", ...report.julia })}\n\n`);
      process.stdout.write(`${formatVersions(versions)}\n`);
    });

  const reportAfter = async (bin: string, label: string, json?: boolean): Promise<void> => {
    const versions = await listVersions(bin, ctx.run);
    if (json) printJson(versions);
    else process.stdout.write(`${label}\n\n${formatVersions(versions)}\n`);
  };

  version
    .command("add <version>")
    .description("Install a Julia version or channel, e.g. 1.10 or release")
    .option("--default", "also set it as the default")
    .option("--json", "print as JSON")
    .action(async (channel: string, opts: { default?: boolean; json?: boolean }) => {
      const bin = await juliaupBin(ctx);
      await addVersion(bin, channel, { default: opts.default }, install);
      await reportAfter(bin, `${pc.green("added")} ${channel}`, opts.json);
    });

  version
    .command("remove <version>")
    .description("Uninstall a Julia version or channel")
    .option("--json", "print as JSON")
    .action(async (channel: string, opts: { json?: boolean }) => {
      const bin = await juliaupBin(ctx);
      await removeVersion(bin, channel, install);
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
    .option("--json", "print as JSON")
    .action(async (channel: string | undefined, opts: { json?: boolean }) => {
      const bin = await juliaupBin(ctx);
      await updateVersion(bin, channel, install);
      await reportAfter(bin, pc.green("updated"), opts.json);
    });

  version
    .command("gc")
    .description("Reclaim disk from uninstalled Julia versions")
    .option("--json", "print as JSON")
    .action(async (opts: { json?: boolean }) => {
      const bin = await juliaupBin(ctx);
      await gcVersions(bin, install);
      await reportAfter(bin, pc.green("collected"), opts.json);
    });
}
