import { mkdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseSpec } from "@mcmcjs/core";
import { createFitRunner, createRunner, type EngineContext, type FitResult } from "@mcmcjs/engine";
import {
  ensureProject,
  type MatrixResult,
  managedProjectDir,
  managedProjectReady,
  resolveVersion,
  runFitAuto,
  runMatrix,
} from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";
import { juliaupBin } from "./julia";
import { rendererFor } from "./progress";

const INSTALL_TIMEOUT_MS = 30 * 60_000;

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
    .option("--keep-going", "with --versions, continue after a version fails")
    .option("--json", "print the result as JSON")
    .action(
      async (
        specPath: string,
        opts: {
          out?: string;
          daemon?: boolean;
          juliaVersion?: string;
          versions?: string;
          keepGoing?: boolean;
          json?: boolean;
        },
      ) => {
        const spec = parseSpec(specPath);
        const bin = await juliaupBin(ctx);
        const installer = createRunner(INSTALL_TIMEOUT_MS);

        if (opts.versions) {
          const versions = opts.versions
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
          const outDir = resolve(opts.out ?? matrixOutDir(specPath));
          mkdirSync(outDir, { recursive: true });

          if (!opts.json) {
            process.stdout.write(
              `Fitting ${spec.backend.id} across ${versions.length} Julia versions...\n`,
            );
          }
          // Each version gets its own managed env so it resolves a Manifest it
          // can actually precompile; provisioning happens per version below.
          const result = await runMatrix(spec, versions, {
            spawn: createFitRunner(),
            outDir,
            resolve: (v) => resolveVersion(bin, v, ctx.run),
            ensure: async (r) => {
              const dir = managedProjectDir(r.version);
              if (!opts.json && !managedProjectReady(dir)) {
                process.stdout.write(`Preparing the Julia ${r.version ?? ""} environment...\n`);
              }
              return ensureProject(r.command, installer, dir);
            },
            keepGoing: opts.keepGoing,
          });
          process.stdout.write(
            opts.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatMatrix(result)}\n`,
          );
          process.exitCode = result.ok ? 0 : 1;
          return;
        }

        const channel = opts.juliaVersion ?? spec.backend.version;
        const outPath = resolve(opts.out ?? defaultOut(specPath));
        const resolved = await resolveVersion(bin, channel, ctx.run);
        const projectDir = managedProjectDir(resolved.version);

        if (!opts.json && !managedProjectReady(projectDir)) {
          process.stdout.write(
            "Preparing the Julia environment (first run can take a few minutes)...\n",
          );
        }
        await ensureProject(resolved.command, installer, projectDir);

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
