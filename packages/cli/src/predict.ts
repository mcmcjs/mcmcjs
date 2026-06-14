import { readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseSamples, parseSpec } from "@mcmcjs/core";
import { createFitRunner, type EngineContext } from "@mcmcjs/engine";
import {
  ensureProject,
  managedProjectDir,
  resolveVersion,
  runPredict,
  validatePins,
} from "@mcmcjs/julia";
import type { Command } from "commander";
import { resolveData } from "./data-file";
import { formatFitResult } from "./fit";
import { installRunner, juliaupBin } from "./julia";

const INSTALL_TIMEOUT_MS = 30 * 60_000;

export function defaultPredictOut(samplesPath: string): string {
  return join(dirname(samplesPath), `${basename(samplesPath, extname(samplesPath))}.predict.json`);
}

export function registerPredict(program: Command, ctx: EngineContext): void {
  program
    .command("predict")
    .argument("<spec>", "inference spec file (TOML or JSON)")
    .argument("<samples>", "posterior samples file from a previous fit")
    .description("Draw posterior-predictive samples from a fitted model")
    .option("-o, --out <file>", "samples output path")
    .option("--julia-version <channel>", "Julia version/channel to run (overrides the spec)")
    .option("--verbose", "show the full raw install/precompile output")
    .option("--json", "print the result as JSON")
    .action(
      async (
        specPath: string,
        samplesPath: string,
        opts: { out?: string; juliaVersion?: string; verbose?: boolean; json?: boolean },
      ) => {
        const spec = parseSpec(specPath);
        validatePins(spec.backend.packages); // fail fast on a bad spec pin
        // Load a referenced data file so predict conditions on the same data.
        spec.data = resolveData(spec.data, spec.dataFilePath).data;
        if (!spec.predict) {
          throw new Error("spec has no [predict] block; add [predict].targets to predict");
        }
        if (spec.backend.id !== "turing") {
          throw new Error(`predict is not yet supported for backend ${spec.backend.id}`);
        }
        // Fail fast if the posterior samples are unreadable, before spawning Julia.
        parseSamples(readFileSync(resolve(samplesPath), "utf8"));

        const channel = opts.juliaVersion ?? spec.backend.version;
        const outPath = resolve(opts.out ?? defaultPredictOut(samplesPath));
        const bin = await juliaupBin(ctx);
        const resolved = await resolveVersion(bin, channel, ctx.run);
        const pins = spec.backend.packages;
        const projectDir = managedProjectDir(resolved.version, pins);
        await ensureProject(
          resolved.command,
          installRunner({
            label: "preparing the Julia environment",
            timeoutMs: INSTALL_TIMEOUT_MS,
            json: opts.json,
            verbose: opts.verbose,
          }),
          projectDir,
          pins,
        );

        if (!opts.json) {
          process.stdout.write(
            `Predicting ${spec.predict.targets.join(", ")} on Julia ${channel}...\n`,
          );
        }
        const result = await runPredict(spec, resolved, {
          spawn: createFitRunner(),
          projectDir,
          outPath,
          samplesPath: resolve(samplesPath),
        });

        process.stdout.write(
          opts.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `${formatFitResult(result, channel, `${outPath}.run.json`)}\n`,
        );
        process.exitCode = result.status === "ok" ? 0 : 1;
      },
    );
}
