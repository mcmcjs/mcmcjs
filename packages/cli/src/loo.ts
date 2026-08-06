import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  chainView,
  type LedgerEntry,
  parseSamples,
  parseSpec,
  type RunRecord,
  readLedger,
  resolveData,
  resolveRunRef,
  runDir,
  type Samples,
} from "@mcmcjs/core";
import {
  compareLoo,
  computeLoo,
  computeWaic,
  type LooResult,
  type PointwiseLogLik,
  relativeEff,
  type WaicResult,
} from "@mcmcjs/diagnostics";
import { createFitRunner, type EngineContext } from "@mcmcjs/engine";
import {
  ensureProject,
  managedProjectDir,
  resolveVersion,
  runLogLik,
  validatePins,
} from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";
import { installRunner, juliaupBin } from "./julia";
import { locateStore } from "./store-cli";

const INSTALL_TIMEOUT_MS = 30 * 60_000;

interface LogLikSource {
  /** Per-observation chain arrays, ready for computeLoo. */
  pointwise: PointwiseLogLik[];
  /** Observation labels, in pointwise order. */
  observations: string[];
  /** Where the log-likelihood came from, for the report. */
  source: "samples" | "cache" | "computed";
  label: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function toPointwise(samples: Samples): { pointwise: PointwiseLogLik[]; observations: string[] } {
  const observations = [...samples.variables];
  const pointwise = observations.map((v) =>
    Array.from({ length: samples.nChains }, (_, c) => chainView(samples, v, c)),
  );
  return { pointwise, observations };
}

/** log_lik columns following the Stan generated-quantities convention, if any. */
function inlineLogLik(
  samples: Samples,
): { pointwise: PointwiseLogLik[]; observations: string[] } | undefined {
  const names = samples.variables.filter((v) => v === "log_lik" || v.startsWith("log_lik["));
  if (names.length === 0) return undefined;
  const pointwise = names.map((v) =>
    Array.from({ length: samples.nChains }, (_, c) => chainView(samples, v, c)),
  );
  return { pointwise, observations: names };
}

/**
 * The pointwise log-likelihood for a run: read from log_lik columns in the
 * samples when the model records them, else from the cached loglik.json when
 * it still matches the samples, else computed through the Julia driver and
 * cached in the run directory.
 */
export async function ensureLogLik(
  storeDir: string,
  entry: LedgerEntry,
  ctx: EngineContext,
  opts: { json?: boolean; verbose?: boolean },
): Promise<LogLikSource> {
  const dir = runDir(storeDir, entry.id);
  const samplesPath = join(dir, "samples.json");
  if (!existsSync(samplesPath)) {
    throw new Error(`run ${entry.id} has no samples; see mcmc runs`);
  }
  const samplesText = readFileSync(samplesPath, "utf8");
  const label = `${entry.id} (${basename(entry.model_path)})`;

  const inline = inlineLogLik(parseSamples(samplesText));
  if (inline) return { ...inline, source: "samples", label };

  const loglikPath = join(dir, "loglik.json");
  const recordPath = `${loglikPath}.run.json`;
  if (existsSync(loglikPath) && existsSync(recordPath)) {
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as RunRecord;
    if (record.posterior_samples_sha256 === sha256(samplesText)) {
      return {
        ...toPointwise(parseSamples(readFileSync(loglikPath, "utf8"))),
        source: "cache",
        label,
      };
    }
  }

  if (entry.backend.id === "stan") {
    throw new Error(
      `run ${entry.id} is a Stan fit without log_lik columns; add a generated quantities block that records log_lik and refit`,
    );
  }

  const spec = parseSpec(join(dir, "spec.toml"));
  validatePins(spec.backend.packages);
  spec.data = resolveData(spec.data, spec.dataFilePath).data;
  const channel = spec.backend.version;
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
    process.stderr.write(`Computing the pointwise log-likelihood for ${entry.id}...\n`);
  }
  const result = await runLogLik(spec, resolved, {
    spawn: createFitRunner(),
    projectDir,
    outPath: loglikPath,
    samplesPath,
  });
  if (result.status !== "ok") {
    throw new Error(
      `log-likelihood failed${result.stage ? ` at ${result.stage}` : ""}: ${result.error}`,
    );
  }
  return {
    ...toPointwise(parseSamples(readFileSync(loglikPath, "utf8"))),
    source: "computed",
    label,
  };
}

/** Resolves a loo/compare target: a run ref, or a samples file carrying log_lik columns. */
async function loadTarget(
  target: string | undefined,
  storeOverride: string | undefined,
  ctx: EngineContext,
  opts: { json?: boolean; verbose?: boolean },
): Promise<LogLikSource> {
  if (target !== undefined && existsSync(target)) {
    const inline = inlineLogLik(parseSamples(readFileSync(target, "utf8")));
    if (!inline) {
      throw new Error(
        `${target} has no log_lik[...] columns; pass a run ref instead so the model is available to compute them`,
      );
    }
    return { ...inline, source: "samples", label: basename(target) };
  }
  if (target !== undefined && (target.includes("/") || target.includes("."))) {
    throw new Error(`samples file not found: ${target}`);
  }
  const storeDir = locateStore(storeOverride);
  const entry = resolveRunRef(readLedger(storeDir), target);
  return ensureLogLik(storeDir, entry, ctx, opts);
}

export interface LooReport {
  label: string;
  source: LogLikSource["source"];
  reff: number;
  loo: LooResult;
  waic: WaicResult;
  /** True when every Pareto k-hat is at or below the reliability threshold. */
  reliable: boolean;
}

export function buildLooReport(src: LogLikSource): LooReport {
  const reff = relativeEff(src.pointwise);
  const loo = computeLoo(src.pointwise, { reff });
  const waic = computeWaic(src.pointwise);
  return { label: src.label, source: src.source, reff, loo, waic, reliable: loo.highK === 0 };
}

function num(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

export function formatLooHuman(report: LooReport): string {
  const { loo, waic } = report;
  const rows: [string, string, string][] = [
    ["elpd_loo", num(loo.elpd), num(loo.se)],
    ["p_loo", num(loo.p), ""],
    ["elpd_waic", num(waic.elpd), num(waic.se)],
    ["p_waic", num(waic.p), ""],
  ];
  const w0 = Math.max(...rows.map((r) => r[0].length));
  const w1 = Math.max("estimate".length, ...rows.map((r) => r[1].length));
  const w2 = Math.max("se".length, ...rows.map((r) => r[2].length));
  let out = `${report.label} — ${loo.nObservations} observations, ${loo.nSamples} draws\n\n`;
  out += `${" ".repeat(w0)}  ${"estimate".padStart(w1)}  ${"se".padStart(w2)}\n`;
  for (const [name, est, se] of rows) {
    out += `${name.padEnd(w0)}  ${est.padStart(w1)}  ${se.padStart(w2)}\n`;
  }
  const kLine = `Pareto k: ${loo.nObservations - loo.highK}/${loo.nObservations} reliable (k <= ${loo.goodK.toFixed(2)}), max ${num(loo.maxK)}`;
  out += `\n${report.reliable ? pc.green(kLine) : pc.red(kLine)}\n`;
  if (!report.reliable) {
    out += `${loo.highK} observation${loo.highK === 1 ? "" : "s"} exceed the threshold; the elpd_loo estimate may be unreliable\n`;
  }
  if (waic.overPenalty > 0) {
    out += pc.yellow(
      `p_waic: ${waic.overPenalty} observation${waic.overPenalty === 1 ? "" : "s"} above 0.4; prefer elpd_loo\n`,
    );
  }
  return out;
}

function jsonReport(report: LooReport): Record<string, unknown> {
  return {
    label: report.label,
    source: report.source,
    observations: report.loo.nObservations,
    samples: report.loo.nSamples,
    reff: report.reff,
    elpd_loo: report.loo.elpd,
    elpd_loo_se: report.loo.se,
    p_loo: report.loo.p,
    elpd_waic: report.waic.elpd,
    elpd_waic_se: report.waic.se,
    p_waic: report.waic.p,
    pareto_k: {
      good_threshold: report.loo.goodK,
      high: report.loo.highK,
      max: report.loo.maxK,
      values: [...report.loo.pointwise.paretoK],
    },
    reliable: report.reliable,
  };
}

interface LooCliOptions {
  store?: string;
  json?: boolean;
  verbose?: boolean;
}

export function registerLoo(program: Command, ctx: EngineContext): void {
  program
    .command("loo")
    .summary("cross-validated model fit (PSIS-LOO, WAIC)")
    .helpGroup("Inspect runs:")
    .argument(
      "[target]",
      "run ref (latest, @N, id prefix), or a samples file with log_lik columns; default: the latest store run",
    )
    .description(
      "Estimate out-of-sample predictive fit with PSIS-LOO cross-validation and WAIC. The pointwise log-likelihood is computed once through the model and cached in the run directory.",
    )
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--verbose", "show the full raw install/precompile output")
    .option("--json", "print the report as JSON")
    .addHelpText(
      "after",
      "\nExit codes: 0 = reliable estimate, 1 = error, 2 = one or more Pareto k above the threshold.",
    )
    .action(async (target: string | undefined, opts: LooCliOptions) => {
      const report = buildLooReport(await loadTarget(target, opts.store, ctx, opts));
      process.stdout.write(
        opts.json ? `${JSON.stringify(jsonReport(report), null, 2)}\n` : formatLooHuman(report),
      );
      process.exitCode = report.reliable ? 0 : 2;
    });
}

export function formatCompareHuman(
  ranked: ReturnType<typeof compareLoo>,
  reports: Map<string, LooReport>,
): string {
  const header = ["rank", "model", "elpd_loo", "se", "elpd_diff", "se_diff", "high_k"];
  const rows = ranked.map((m, i) => [
    String(i + 1),
    m.name,
    num(m.result.elpd),
    num(m.result.se),
    num(m.elpdDiff),
    num(m.seDiff),
    String(m.result.highK),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] as string).length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === 1 ? c.padEnd(widths[i] as number) : c.padStart(widths[i] as number)))
      .join("  ");
  let out = `${line(header)}\n${widths.map((w) => "-".repeat(w)).join("  ")}\n`;
  for (const row of rows) out += `${line(row as string[])}\n`;
  const unreliable = ranked.filter((m) => !(reports.get(m.name)?.reliable ?? true));
  if (unreliable.length > 0) {
    out += pc.red(
      `\n${unreliable.map((m) => m.name).join(", ")}: Pareto k above the threshold; the ranking may be unreliable\n`,
    );
  }
  return out;
}

export function registerCompare(program: Command, ctx: EngineContext): void {
  program
    .command("compare")
    .summary("rank runs by out-of-sample fit")
    .helpGroup("Inspect runs:")
    .argument("<targets...>", "two or more run refs (or samples files with log_lik columns)")
    .description(
      "Compare models by PSIS-LOO: ranked by elpd_loo, with paired-difference standard errors against the best model. Every run must score the same observations.",
    )
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--verbose", "show the full raw install/precompile output")
    .option("--json", "print the comparison as JSON")
    .addHelpText(
      "after",
      "\nExit codes: 0 = reliable comparison, 1 = error, 2 = some Pareto k above the threshold.",
    )
    .action(async (targets: string[], opts: LooCliOptions) => {
      if (targets.length < 2) throw new Error("compare needs at least two runs");
      const reports = new Map<string, LooReport>();
      const models: { name: string; result: LooResult }[] = [];
      for (const target of targets) {
        const report = buildLooReport(await loadTarget(target, opts.store, ctx, opts));
        // Duplicate labels (same run twice) stay distinct in the table.
        const name = reports.has(report.label)
          ? `${report.label} (${models.length + 1})`
          : report.label;
        reports.set(name, report);
        models.push({ name, result: report.loo });
      }
      const ranked = compareLoo(models);
      const reliable = ranked.every((m) => reports.get(m.name)?.reliable ?? true);

      if (opts.json) {
        const payload = ranked.map((m, i) => ({
          rank: i + 1,
          ...jsonReport(reports.get(m.name) as LooReport),
          elpd_diff: m.elpdDiff,
          se_diff: m.seDiff,
        }));
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else {
        process.stdout.write(formatCompareHuman(ranked, reports));
      }
      process.exitCode = reliable ? 0 : 2;
    });
}
