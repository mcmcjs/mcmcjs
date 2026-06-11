import { mkdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseSpec } from "@mcmcjs/core";
import { createFitRunner, createRunner, type EngineContext, type FitResult } from "@mcmcjs/engine";
import {
  ensureProject,
  type MatrixResult,
  managedProjectReady,
  resolveVersion,
  runFit,
  runMatrix,
} from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";
import { juliaupBin } from "./julia";
import { createProgressRenderer, silentProgress } from "./progress";

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
    .option("--julia-version <channel>", "Julia version/channel to run (overrides the spec)")
    .option("--versions <list>", "run the spec across these Julia versions (comma-separated)")
    .option("--keep-going", "with --versions, continue after a version fails")
    .option("--json", "print the result as JSON")
    .action(
      async (
        specPath: string,
        opts: {
          out?: string;
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

          // Provision the managed project once, using the first installed version.
          let projectJulia: { command: string; args: string[] } | undefined;
          for (const v of versions) {
            try {
              projectJulia = await resolveVersion(bin, v, ctx.run);
              break;
            } catch {}
          }
          if (!projectJulia) {
            throw new Error(
              `none of the requested Julia versions are installed: ${versions.join(", ")}. Install one with: mcmc julia version add <version>`,
            );
          }
          if (!opts.json && !managedProjectReady()) {
            process.stdout.write(
              "Preparing the Julia environment (first run can take a few minutes)...\n",
            );
          }
          const projectDir = await ensureProject(projectJulia.command, installer);

          if (!opts.json) {
            process.stdout.write(
              `Fitting ${spec.backend.id} across ${versions.length} Julia versions...\n`,
            );
          }
          const result = await runMatrix(spec, versions, {
            spawn: createFitRunner(),
            projectDir,
            outDir,
            resolve: (v) => resolveVersion(bin, v, ctx.run),
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

        if (!opts.json && !managedProjectReady()) {
          process.stdout.write(
            "Preparing the Julia environment (first run can take a few minutes)...\n",
          );
        }
        const projectDir = await ensureProject(resolved.command, installer);

        if (!opts.json) process.stdout.write(`Fitting ${spec.backend.id} on Julia ${channel}...\n`);
        const progress = opts.json
          ? silentProgress
          : createProgressRenderer({
              tty: process.stderr.isTTY === true,
              write: (text) => process.stderr.write(text),
            });
        const result = await runFit(spec, resolved, {
          spawn: createFitRunner(),
          projectDir,
          outPath,
          onProgress: progress.onProgress,
        });
        progress.finish();

        process.stdout.write(
          opts.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `${formatFitResult(result, channel, `${outPath}.run.json`)}\n`,
        );
        process.exitCode = result.status === "ok" ? 0 : 1;
      },
    );
}
