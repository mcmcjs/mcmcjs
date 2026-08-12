import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chainView,
  parseSamples,
  type ResolvedSpec,
  resolveData,
  type Samples,
  SpecSchema,
} from "@mcmcjs/core";
import { type SbcUniformity, sbcUniformity } from "@mcmcjs/diagnostics";
import { createFitRunner, type EngineContext } from "@mcmcjs/engine";
import {
  ensureProject,
  managedProjectDir,
  resolveVersion,
  runFitAuto,
  runPredict,
  validatePins,
} from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";
import { installRunner, juliaupBin } from "./julia";
import { parseIntOption } from "./options";
import { buildRunConfig, type RunCliOptions } from "./run";

const INSTALL_TIMEOUT_MS = 30 * 60_000;
const MAX_SEED = 2_147_483_647;

/** The leaves of one target variable in a samples file, ordered by index. */
export function targetLeaves(variables: readonly string[], target: string): string[] {
  const exact = variables.includes(target);
  const indexed = variables
    .filter((v) => v.startsWith(`${target}[`))
    .map((v) => {
      const inner = v.slice(target.length + 1, -1);
      if (inner.includes(",")) {
        throw new Error(`sbc supports scalar and vector outcomes; ${v} is multi-dimensional`);
      }
      return { name: v, index: Number.parseInt(inner, 10) };
    })
    .sort((a, b) => a.index - b.index);
  if (exact && indexed.length > 0) {
    throw new Error(`the predictive draws hold both ${target} and ${target}[...]`);
  }
  if (!exact && indexed.length === 0) {
    throw new Error(`no predictive draws for target "${target}"`);
  }
  return exact ? [target] : indexed.map((v) => v.name);
}

/** One simulated dataset: the template with each target replaced by predictive draw i. */
export function simulatedDataFor(
  template: Record<string, unknown>,
  targets: readonly string[],
  predictive: Samples,
  draw: number,
): Record<string, unknown> {
  const data = { ...template };
  for (const target of targets) {
    const leaves = targetLeaves(predictive.variables, target);
    const values = leaves.map((leaf) => chainView(predictive, leaf, 0)[draw] as number);
    data[target] = leaves.length === 1 && leaves[0] === target ? values[0] : values;
  }
  return data;
}

/**
 * The rank of each prior draw within its posterior: the count of thinned
 * posterior draws below the prior value. With rankDraws L, ranks live in
 * 0..L, so nPossible = L + 1.
 */
export function ranksFor(
  prior: Samples,
  posterior: Samples,
  draw: number,
  rankDraws: number,
): Map<string, { rank: number; nPossible: number }> {
  const out = new Map<string, { rank: number; nPossible: number }>();
  for (const name of prior.variables) {
    if (!posterior.variables.includes(name)) continue;
    const total = posterior.nDraws * posterior.nChains;
    const L = Math.min(rankDraws, total);
    const truth = chainView(prior, name, 0)[draw] as number;
    let rank = 0;
    for (let k = 0; k < L; k++) {
      const s = Math.floor((k * total) / L);
      const chain = Math.floor(s / posterior.nDraws);
      const value = chainView(posterior, name, chain)[s % posterior.nDraws] as number;
      if (value < truth) rank += 1;
    }
    out.set(name, { rank, nPossible: L + 1 });
  }
  return out;
}

export interface SbcParameterReport extends SbcUniformity {
  name: string;
  ranks: number[];
}

export interface SbcReport {
  simulations: number;
  rankDraws: number;
  /** Family-wise level; each parameter is tested at alpha / parameters. */
  alpha: number;
  parameters: SbcParameterReport[];
  calibrated: boolean;
}

export function buildSbcReport(
  perParameter: Map<string, number[]>,
  nPossible: number,
  opts: { bins?: number; alpha?: number; rankDraws: number; simulations: number },
): SbcReport {
  const alpha = opts.alpha ?? 0.05;
  const parameters = [...perParameter.entries()].map(([name, ranks]) => ({
    name,
    ranks,
    ...sbcUniformity(ranks, nPossible, { bins: opts.bins }),
  }));
  const threshold = alpha / Math.max(1, parameters.length);
  return {
    simulations: opts.simulations,
    rankDraws: opts.rankDraws,
    alpha,
    parameters,
    calibrated: parameters.every((p) => p.pValue >= threshold),
  };
}

const BLOCKS = " ▁▂▃▄▅▆▇█";

function sparkline(counts: number[]): string {
  const max = Math.max(1, ...counts);
  return counts.map((c) => BLOCKS[Math.min(8, Math.ceil((c / max) * 8))] ?? " ").join("");
}

export function formatSbcHuman(report: SbcReport): string {
  const threshold = report.alpha / Math.max(1, report.parameters.length);
  const w = Math.max("parameter".length, ...report.parameters.map((p) => p.name.length));
  let out = `${report.simulations} simulations, ranks over ${report.rankDraws} posterior draws\n\n`;
  out += `${"parameter".padEnd(w)}  ${"p".padStart(6)}  ranks\n`;
  for (const p of report.parameters) {
    const pText = Number.isFinite(p.pValue) ? p.pValue.toFixed(4) : "n/a";
    const line = `${p.name.padEnd(w)}  ${pText.padStart(6)}  ${sparkline(p.counts)}`;
    out += `${p.pValue < threshold ? pc.red(line) : line}\n`;
  }
  const verdict = report.calibrated ? pc.green("calibrated") : pc.red("not calibrated");
  out += `\n${verdict} (uniform ranks at family level ${report.alpha}, per-parameter p >= ${threshold.toExponential(1)})\n`;
  return out;
}

interface SbcCliOptions extends RunCliOptions {
  simulations: number;
  rankDraws: number;
  bins?: number;
}

export function registerSbc(program: Command, ctx: EngineContext): void {
  program
    .command("sbc")
    .summary("simulation-based calibration check")
    .helpGroup("Run inference:")
    .argument("<input>", "model file (.jl) or spec (.toml/.json) with a [predict] block")
    .description(
      "Validate the whole inference pipeline by simulation-based calibration: draw parameters from the prior, simulate datasets through the model, refit each one, and test that the true parameters' posterior ranks are uniform.",
    )
    .option("--simulations <n>", "simulated datasets to fit", parseIntOption, 20)
    .option("--rank-draws <n>", "posterior draws per rank (thinned evenly)", parseIntOption, 100)
    .option(
      "--bins <n>",
      "rank histogram bins (default: simulations / 5, at most 20)",
      parseIntOption,
    )
    .option("--data <file>", "data file (.json object or .csv columns)")
    .option("--draws <n>", "posterior draws per refit (default 1000)", parseIntOption)
    .option("--warmup <n>", "warmup iterations per refit (default 1000)", parseIntOption)
    .option("--chains <n>", "chains per refit (default 4)", parseIntOption)
    .option("--seed <n>", "base random seed", parseIntOption)
    .option("--algorithm <name>", "sampler for the refits (default NUTS)")
    .option("--adtype <name>", "AD backend for gradient samplers")
    .option("--parallel <mode>", "chain execution per refit: serial | threads")
    .option("--entry <name>", "model entry function (default build_model)")
    .option("--backend <id>", "backend (default: detected from the model)")
    .option("--daemon", "fit through a persistent Julia worker (much faster per refit)")
    .option("--julia-version <channel>", "Julia version/channel to run")
    .option("--verbose", "show the full raw install/precompile output")
    .option("--json", "print the report as JSON")
    .addHelpText(
      "after",
      "\nExit codes: 0 = calibrated, 1 = error, 2 = ranks depart from uniform.\nStatistical power grows with --simulations; 20 catches gross errors, 100+ is publication grade.",
    )
    .action(async (input: string, opts: SbcCliOptions) => {
      const config = buildRunConfig(input, opts);
      const spec = config.spec;
      if (spec.backend.id === "stan") {
        throw new Error("sbc needs prior sampling, which the stan backend does not support");
      }
      if (!spec.predict) {
        throw new Error(
          "sbc simulates the outcomes named in [predict].targets; add a predict block",
        );
      }
      validatePins(spec.backend.packages);
      const template = resolveData(spec.data, config.dataFile).data;
      const say = (line: string) => {
        if (!opts.json) process.stderr.write(`${line}\n`);
      };

      const bin = await juliaupBin(ctx);
      const resolved = await resolveVersion(bin, config.channel, ctx.run);
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

      const tmp = mkdtempSync(join(tmpdir(), "mcmc-sbc-"));
      try {
        const base: ResolvedSpec = {
          ...spec,
          data: template,
          specPath: join(tmp, "spec.toml"),
          modelPath: config.modelPath,
          specHash: "sbc",
        };
        const spawn = createFitRunner();
        const env = { command: resolved.command, args: resolved.args };

        say(`Drawing ${opts.simulations} parameter sets from the prior...`);
        const priorSpec: ResolvedSpec = {
          ...base,
          sampler: SpecSchema.parse({
            ...spec,
            sampler: { algorithm: "Prior", draws: opts.simulations, chains: 1, warmup: 0 },
          }).sampler,
        };
        const priorPath = join(tmp, "prior.json");
        const prior = await runFitAuto(priorSpec, env, {
          spawn,
          projectDir,
          outPath: priorPath,
          recordPath: join(tmp, "prior.run.json"),
          daemon: opts.daemon,
        });
        if (prior.status !== "ok") throw new Error(`prior sampling failed: ${prior.error}`);

        say("Simulating datasets through the model...");
        const yrepPath = join(tmp, "yrep.json");
        const predicted = await runPredict(priorSpec, env, {
          spawn,
          projectDir,
          outPath: yrepPath,
          samplesPath: priorPath,
        });
        if (predicted.status !== "ok") throw new Error(`simulation failed: ${predicted.error}`);

        const priorSamples = parseSamples(readFileSync(priorPath, "utf8"));
        const predictive = parseSamples(readFileSync(yrepPath, "utf8"));
        const perParameter = new Map<string, number[]>();
        let nPossible = 0;

        for (let i = 0; i < opts.simulations; i++) {
          const fitSpec: ResolvedSpec = {
            ...base,
            data: simulatedDataFor(template, spec.predict.targets, predictive, i),
            seed: (spec.seed + i + 1) % MAX_SEED,
          };
          const outPath = join(tmp, `sim-${i}.json`);
          const fit = await runFitAuto(fitSpec, env, {
            spawn,
            projectDir,
            outPath,
            recordPath: join(tmp, `sim-${i}.run.json`),
            daemon: opts.daemon,
          });
          if (fit.status !== "ok") {
            throw new Error(`simulation ${i + 1}/${opts.simulations} failed to fit: ${fit.error}`);
          }
          const posterior = parseSamples(readFileSync(outPath, "utf8"));
          const ranks = ranksFor(priorSamples, posterior, i, opts.rankDraws);
          if (ranks.size === 0) {
            throw new Error("the refit shares no parameters with the prior draws");
          }
          for (const [name, r] of ranks) {
            nPossible = r.nPossible;
            const list = perParameter.get(name) ?? [];
            list.push(r.rank);
            perParameter.set(name, list);
          }
          say(`  fit ${i + 1}/${opts.simulations} done`);
        }

        const report = buildSbcReport(perParameter, nPossible, {
          bins: opts.bins,
          rankDraws: nPossible - 1,
          simulations: opts.simulations,
        });
        process.stdout.write(
          opts.json ? `${JSON.stringify(report, null, 2)}\n` : formatSbcHuman(report),
        );
        process.exitCode = report.calibrated ? 0 : 2;
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
}
