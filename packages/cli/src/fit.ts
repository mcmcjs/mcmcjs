import { mkdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseSpec } from "@mcmcjs/core";
import { createFitRunner, type EngineContext, type FitResult } from "@mcmcjs/engine";
import {
  ensureProject,
  type MatrixEntry,
  type MatrixResult,
  managedProjectDir,
  managedProjectReady,
  resolveVersion,
  runFit,
  runFitAuto,
  runMatrix,
  validatePins,
} from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";
import { resolveData } from "./data-file";
import { installRunner, juliaupBin } from "./julia";
import { rendererFor } from "./progress";

const INSTALL_TIMEOUT_MS = 30 * 60_000;

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
export function formatFitResult(result: FitResult, channel: string, recordPath: string): string {
  if (result.status === "ok") {
    return `${pc.green("ok")} ${result.samplesFile} (Julia ${result.runtimeActual ?? channel}, ${result.elapsedMs} ms)\n${pc.dim(`run record: ${recordPath}`)}`;
  }
  return `${pc.red("fit failed")}${result.stage ? ` at ${result.stage}` : ""}: ${result.error}`;
}

/** Renders a multi-version matrix result for the terminal. */
export function formatMatrix(result: MatrixResult): string {
  const lines = result.entries.map((e) =>
    e.status === "ok"
      ? `${pc.green("ok")}   ${e.version.padEnd(10)} ${e.elapsedMs} ms  ${pc.dim(e.samplesFile ?? "")}`
      : `${pc.red("fail")} ${e.version.padEnd(10)} ${e.error ?? ""}`,
  );
  lines.push("");
  lines.push(result.ok ? pc.green("all versions ok") : pc.red("some versions failed"));
  return lines.join("\n");
}

export function registerFit(program: Command, ctx: EngineContext): void {
  program
    .command("fit")
    .argument("<spec>", "inference spec file (TOML or JSON)")
    .description("Run MCMC inference for a spec and write a samples file")
    .option("-o, --out <path>", "samples output file, or directory when --versions is used")
    .option("--daemon", "fit through a persistent Julia worker (or set MCMC_DAEMON=1)")
    .option("--julia-version <channel>", "Julia version/channel to run (overrides the spec)")
    .option("--versions <list>", "run the spec across these Julia versions (comma-separated)")
    .option(
      "--package-versions <name=list>",
      "run the spec across these versions of one managed package (e.g. Turing=0.44,0.45)",
    )
    .option("--keep-going", "with --versions/--package-versions, continue after a failure")
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
          json?: boolean;
        },
      ) => {
        const spec = parseSpec(specPath);
        validatePins(spec.backend.packages); // fail fast on a bad spec pin
        // Load a referenced data file (recorded by path + hash, not inlined).
        const resolvedData = resolveData(spec.data, spec.dataFilePath);
        spec.data = resolvedData.data;
        const bin = await juliaupBin(ctx);
        const installer = installRunner(opts.json, INSTALL_TIMEOUT_MS);

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
            ensure: async (r) => {
              const dir = managedProjectDir(r.version, pins);
              if (!opts.json && !managedProjectReady(dir, pins)) {
                process.stdout.write(`Preparing the Julia ${r.version ?? ""} environment...\n`);
              }
              return ensureProject(r.command, installer, dir, pins);
            },
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
              if (!opts.json && !managedProjectReady(dir, pins)) {
                process.stdout.write(`Preparing ${name} ${v} (this can take a few minutes)...\n`);
              }
              await ensureProject(resolved.command, installer, dir, pins);
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

        if (!opts.json && !managedProjectReady(projectDir, pins)) {
          process.stdout.write(
            "Preparing the Julia environment (first run can take a few minutes)...\n",
          );
        }
        await ensureProject(resolved.command, installer, projectDir, pins);

        if (!opts.json) process.stdout.write(`Fitting ${spec.backend.id} on Julia ${channel}...\n`);
        const progress = rendererFor(opts.json);
        let result: Awaited<ReturnType<typeof runFitAuto>>;
        try {
          result = await runFitAuto(spec, resolved, {
            spawn: createFitRunner(),
            projectDir,
            outPath,
            onProgress: progress.onProgress,
            daemon: opts.daemon ?? process.env.MCMC_DAEMON === "1",
            notify: (line) => {
              if (!opts.json) process.stdout.write(`${line}\n`);
            },
            dataFile: resolvedData.dataFile,
            dataSha256: resolvedData.dataSha256,
          });
        } finally {
          progress.finish();
        }

        process.stdout.write(
          opts.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `${formatFitResult(result, channel, `${outPath}.run.json`)}\n`,
        );
        process.exitCode = result.status === "ok" ? 0 : 1;
      },
    );
}
