import type { EngineContext, RuntimeVersion } from "@mcmcjs/engine";
import {
  addVersion,
  listVersions,
  PINNED_CMDSTAN_VERSION,
  removeVersion,
  runDoctor,
} from "@mcmcjs/stan";
import type { Command } from "commander";
import pc from "picocolors";
import { installRunner } from "./julia";
import { formatStanSetupResult } from "./setup";

const INSTALL_TIMEOUT_MS = 60 * 60_000;

/** Renders installed CmdStan versions; the newest (the default) gets an asterisk. */
export function formatStanVersions(versions: RuntimeVersion[]): string {
  if (versions.length === 0) {
    return `no CmdStan versions installed. Add one with: mcmc stan version add ${PINNED_CMDSTAN_VERSION}`;
  }
  return versions
    .map((v) => {
      const marker = v.isDefault ? pc.green("*") : " ";
      return `${marker} ${v.id.padEnd(12)} ${pc.dim(v.path ?? "")}`;
    })
    .join("\n");
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function registerStan(program: Command, ctx: EngineContext): void {
  // The read-only status view, shared by bare `mcmc stan`, `stan version`
  // (the default), and `stan version status` so all show the same thing.
  const showStatus = async (opts: { json?: boolean }) => {
    const [versions, report] = await Promise.all([listVersions(), runDoctor(ctx.run)]);
    if (opts.json) {
      printJson({
        versions,
        cmdstan: report.cmdstan,
        stanc: report.stanc,
        make: report.make,
        cxx: report.cxx,
        ready: report.ready,
      });
      return;
    }
    process.stdout.write(`${formatStanVersions(versions)}\n`);
  };

  const stan = program
    .command("stan")
    .summary("manage the Stan runtime (CmdStan)")
    .helpGroup("Toolchain:")
    .description("Manage the Stan runtime (CmdStan)");

  // `version` is stan's default and `status` is version's default, so bare
  // `mcmc stan` and `mcmc stan version` show the status and exit 0.
  const version = stan
    .command("version", { isDefault: true })
    .description("Manage installed CmdStan versions");

  version
    .command("list")
    .description("List installed CmdStan versions (the newest is the default)")
    .option("--json", "print as JSON")
    .action(async (opts: { json?: boolean }) => {
      const versions = listVersions();
      if (opts.json) printJson(versions);
      else process.stdout.write(`${formatStanVersions(versions)}\n`);
    });

  version
    .command("status", { isDefault: true })
    .description("Show installed CmdStan versions and toolchain health")
    .option("--json", "print as JSON")
    .action(showStatus);

  version
    .command("add")
    .description("Download and build a CmdStan version into the managed root")
    .argument("[version]", `CmdStan version (default ${PINNED_CMDSTAN_VERSION})`)
    .option("--verbose", "show the full raw install output instead of a collapsed spinner")
    .option("--json", "print the result as JSON")
    .action(async (v: string | undefined, opts: { verbose?: boolean; json?: boolean }) => {
      const result = await addVersion(v ?? PINNED_CMDSTAN_VERSION, {
        installer: installRunner({
          label: `installing CmdStan ${v ?? PINNED_CMDSTAN_VERSION}`,
          timeoutMs: INSTALL_TIMEOUT_MS,
          json: opts.json,
          verbose: opts.verbose,
        }),
      });
      if (opts.json) printJson(result);
      else process.stdout.write(`${formatStanSetupResult(result)}\n`);
      process.exitCode = result.ready ? 0 : 1;
    });

  version
    .command("remove")
    .description("Remove a managed CmdStan version")
    .argument("<version>", "installed CmdStan version to remove")
    .action(async (v: string) => {
      removeVersion(v);
      process.stdout.write(`removed CmdStan ${v}\n`);
    });
}
