import { mkdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseSpec, resolveData } from "@mcmcjs/core";
import { createFitRunner, type EngineContext, type FitResult } from "@mcmcjs/engine";
import {
  ensureProject,
  type MatrixEntry,
  type MatrixResult,
  managedProjectDir,
  resolveVersion,
  runFit,
  runFitAuto,
  runMatrix,
  validatePins,
} from "@mcmcjs/julia";
import { resolveCmdStan, runFit as runStanFit, runMatrix as runStanMatrix } from "@mcmcjs/stan";
import type { Command } from "commander";
import pc from "picocolors";
import { installRunner, juliaupBin } from "./julia";
import { rendererFor } from "./progress";

const INSTALL_TIMEOUT_MS = 30 * 60_000;

const BACKEND_NAMES: Record<string, string> = {
  turing: "Turing.jl",
  juliabugs: "JuliaBUGS",
  stan: "Stan",
};

/** A human display name for a backend id (e.g. "turing" -> "Turing.jl"). */
export function backendLabel(id: string): string {
  return BACKEND_NAMES[id] ?? id;
}

/** Parses a `name=v1,v2,...` package-matrix argument. */
export function parsePackageVersions(arg: string): { name: string; versions: string[] } {
  const at = arg.indexOf("=");
  if (at <= 0) throw new Error(`--package-versions expects name=v1,v2, got "${arg}"`);
  const name = arg.slice(0, at).trim();
  const versions = arg
    .slice(at + 1)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (versions.length === 0) throw new Error(`--package-versions: no versions listed for ${name}`);
  // Fail fast on an unmanaged name or an unsafe version string.
  for (const v of versions) validatePins({ [name]: v });
  return { name, versions };
}

/** The MatrixEntry fields carried over from a FitResult. */
function resultFields(result: FitResult): Omit<MatrixEntry, "version"> {
  return {
    status: result.status,
    samplesFile: result.samplesFile,
    runtimeActual: result.runtimeActual,
    elapsedMs: result.elapsedMs,
    stage: result.stage,
    error: result.error,
  };
}

export function defaultOut(specPath: string): string {
  return join(dirname(specPath), `${basename(specPath, extname(specPath))}.samples.json`);
}

export function matrixOutDir(specPath: string): string {
  return join(dirname(specPath), `${basename(specPath, extname(specPath))}.samples`);
}

/** Renders a single fit result for the terminal. */
export function formatFitResult(
  result: FitResult,
  channel: string,
  recordPath: string,
  runtimeName = "Julia",
): string {
  if (result.status === "ok") {
    return `${pc.green("ok")} ${result.samplesFile} (${runtimeName} ${result.runtimeActual ?? channel}, ${result.elapsedMs} ms)\n${pc.dim(`run record: ${recordPath}`)}`;
  }
  if (result.status === "cancelled") {
    return `${pc.yellow("cancelled")}: the fit was stopped before finishing`;
  }
  return `${pc.red("fit failed")}${result.stage ? ` at ${result.stage}` : ""}: ${result.error}`;
}

/** Renders a multi-version matrix result for the terminal. */
export function formatMatrix(result: MatrixResult): string {
  const lines = result.entries.map((e) => {
    if (e.status === "ok") {
      return `${pc.green("ok")}   ${e.version.padEnd(10)} ${e.elapsedMs} ms  ${pc.dim(e.samplesFile ?? "")}`;
    }
    if (e.status === "cancelled") {
      return `${pc.yellow("canc")} ${e.version.padEnd(10)} cancelled`;
    }
    return `${pc.red("fail")} ${e.version.padEnd(10)} ${e.error ?? ""}`;
  });
  lines.push("");
  lines.push(result.ok ? pc.green("all versions ok") : pc.red("some versions failed"));
  return lines.join("\n");
}

export function registerFit(program: Command, ctx: EngineContext): void {
  program
    .command("fit")
    .summary("run MCMC inference, write a samples file")
    .helpGroup("Run inference:")
    .argument("<spec>", "inference spec file (TOML or JSON)")
    .description("Run MCMC inference for a spec and write a samples file")
    .option("-o, --out <path>", "samples output file, or directory when --versions is used")
    .option("--daemon", "fit through a persistent Julia worker (or set MCMC_DAEMON=1)")
    .option("--julia-version <channel>", "Julia version/channel to run (overrides the spec)")
    .option(
      "--versions <list>",
      "run the spec across these Julia or CmdStan versions (comma-separated)",
    )
    .option(
      "--package-versions <name=list>",
      "run the spec across these versions of one managed package (e.g. Turing=0.44,0.45)",
    )
    .option("--keep-going", "with --versions/--package-versions, continue after a failure")
    .option("--verbose", "show the full raw install/precompile output, not a collapsed spinner")
    .option("--json", "print the result as JSON")
    .action(
      async (
        specPath: string,
        opts: {
          out?: string;
          daemon?: boolean;
          juliaVersion?: string;
          versions?: string;
          packageVersions?: string;
          keepGoing?: boolean;
          verbose?: boolean;
          json?: boolean;
        },
      ) => {
        const spec = parseSpec(specPath);
        validatePins(spec.backend.packages); // fail fast on a bad spec pin
        // Load a referenced data file (recorded by path + hash, not inlined).
        const resolvedData = resolveData(spec.data, spec.dataFilePath);
        spec.data = resolvedData.data;

        if (spec.backend.id === "stan") {
          for (const [set, flag] of [
            [opts.packageVersions, "--package-versions"],
            [opts.daemon, "--daemon"],
            [opts.juliaVersion, "--julia-version"],
          ] as const) {
            if (set) throw new Error(`${flag} does not apply to a Stan spec`);
          }

          if (opts.versions) {
            const versions = opts.versions
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean);
            const outDir = resolve(opts.out ?? matrixOutDir(specPath));
            mkdirSync(outDir, { recursive: true });
            if (!opts.json) {
              process.stdout.write(`Fitting stan across ${versions.length} CmdStan versions...\n`);
            }
            const result = await runStanMatrix(spec, versions, {
              outDir,
              dataFile: resolvedData.dataFile,
              dataSha256: resolvedData.dataSha256,
              keepGoing: opts.keepGoing,
            });
            process.stdout.write(
              opts.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatMatrix(result)}\n`,
            );
            process.exitCode = result.ok ? 0 : 1;
            return;
          }

          const install = resolveCmdStan(spec.backend.version);
          const outPath = resolve(opts.out ?? defaultOut(specPath));
          if (!opts.json) {
            process.stdout.write(`Fitting stan on CmdStan ${install.version}...\n`);
          }
          const progress = rendererFor(opts.json, backendLabel(spec.backend.id), "CmdStan");
          const controller = new AbortController();
          const onSigint = () => controller.abort();
          process.once("SIGINT", onSigint);
          let result: FitResult;
          try {
            result = await runStanFit(spec, install, {
              outPath,
              onProgress: progress.onProgress,
              signal: controller.signal,
              dataFile: resolvedData.dataFile,
              dataSha256: resolvedData.dataSha256,
            });
          } finally {
            process.removeListener("SIGINT", onSigint);
            progress.finish();
          }
          process.stdout.write(
            opts.json
              ? `${JSON.stringify(result, null, 2)}\n`
              : `${formatFitResult(result, spec.backend.version, `${outPath}.run.json`, "CmdStan")}\n`,
          );
          process.exitCode = result.status === "ok" ? 0 : result.status === "cancelled" ? 130 : 1;
          return;
        }

        const bin = await juliaupBin(ctx);
        const provision = (label: string) =>
          installRunner({
            label,
            timeoutMs: INSTALL_TIMEOUT_MS,
            json: opts.json,
            verbose: opts.verbose,
          });

        if (opts.versions && opts.packageVersions) {
          throw new Error("use either --versions or --package-versions, not both");
        }

        if (opts.versions) {
          const versions = opts.versions
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
          const pins = spec.backend.packages;
          const outDir = resolve(opts.out ?? matrixOutDir(specPath));
          mkdirSync(outDir, { recursive: true });

          if (!opts.json) {
            process.stdout.write(
              `Fitting ${spec.backend.id} across ${versions.length} Julia versions...\n`,
            );
          }
          // Each version gets its own managed env (honoring any spec package
          // pins) so it resolves a Manifest it can actually precompile.
          const result = await runMatrix(spec, versions, {
            spawn: createFitRunner(),
            outDir,
            resolve: (v) => resolveVersion(bin, v, ctx.run),
            ensure: (r) =>
              ensureProject(
                r.command,
                provision(
                  r.version
                    ? `preparing the Julia ${r.version} environment`
                    : "preparing the Julia environment",
                ),
                managedProjectDir(r.version, pins),
                pins,
                { version: r.version },
              ),
            dataFile: resolvedData.dataFile,
            dataSha256: resolvedData.dataSha256,
            keepGoing: opts.keepGoing,
          });
          process.stdout.write(
            opts.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatMatrix(result)}\n`,
          );
          process.exitCode = result.ok ? 0 : 1;
          return;
        }

        if (opts.packageVersions) {
          const { name, versions } = parsePackageVersions(opts.packageVersions);
          const channel = opts.juliaVersion ?? spec.backend.version;
          const resolved = await resolveVersion(bin, channel, ctx.run);
          const outDir = resolve(opts.out ?? matrixOutDir(specPath));
          mkdirSync(outDir, { recursive: true });
          if (!opts.json) {
            process.stdout.write(
              `Fitting ${spec.backend.id} across ${versions.length} ${name} versions on Julia ${channel}...\n`,
            );
          }
          const entries: MatrixEntry[] = [];
          for (const v of versions) {
            const pins = { ...spec.backend.packages, [name]: v };
            const dir = managedProjectDir(resolved.version, pins);
            let entry: MatrixEntry;
            try {
              await ensureProject(
                resolved.command,
                provision(`preparing ${name} ${v}`),
                dir,
                pins,
                {
                  version: resolved.version,
                },
              );
              const result = await runFit(spec, resolved, {
                spawn: createFitRunner(),
                projectDir: dir,
                outPath: join(outDir, `${name}-${v}.samples.json`),
                dataFile: resolvedData.dataFile,
                dataSha256: resolvedData.dataSha256,
              });
              entry = { version: `${name}=${v}`, ...resultFields(result) };
            } catch (error) {
              entry = {
                version: `${name}=${v}`,
                status: "error",
                elapsedMs: 0,
                error: (error as Error).message,
              };
            }
            entries.push(entry);
            if (entry.status === "error" && !opts.keepGoing) break;
          }
          const result: MatrixResult = {
            entries,
            ok: entries.length === versions.length && entries.every((e) => e.status === "ok"),
          };
          process.stdout.write(
            opts.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatMatrix(result)}\n`,
          );
          process.exitCode = result.ok ? 0 : 1;
          return;
        }

        const channel = opts.juliaVersion ?? spec.backend.version;
        const outPath = resolve(opts.out ?? defaultOut(specPath));
        const resolved = await resolveVersion(bin, channel, ctx.run);
        const pins = spec.backend.packages;
        const projectDir = managedProjectDir(resolved.version, pins);
        await ensureProject(
          resolved.command,
          provision("preparing the Julia environment"),
          projectDir,
          pins,
          { version: resolved.version },
        );

        if (!opts.json) process.stdout.write(`Fitting ${spec.backend.id} on Julia ${channel}...\n`);
        const progress = rendererFor(opts.json, backendLabel(spec.backend.id));
        const controller = new AbortController();
        const onSigint = () => controller.abort();
        process.once("SIGINT", onSigint);
        let result: Awaited<ReturnType<typeof runFitAuto>>;
        try {
          result = await runFitAuto(spec, resolved, {
            spawn: createFitRunner(),
            projectDir,
            outPath,
            onProgress: progress.onProgress,
            signal: controller.signal,
            daemon: opts.daemon ?? process.env.MCMC_DAEMON === "1",
            notify: (line) => {
              if (!opts.json) process.stdout.write(`${line}\n`);
            },
            dataFile: resolvedData.dataFile,
            dataSha256: resolvedData.dataSha256,
          });
        } finally {
          process.removeListener("SIGINT", onSigint);
          progress.finish();
        }

        process.stdout.write(
          opts.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `${formatFitResult(result, channel, `${outPath}.run.json`)}\n`,
        );
        process.exitCode = result.status === "ok" ? 0 : result.status === "cancelled" ? 130 : 1;
      },
    );
}
