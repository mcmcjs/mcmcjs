import { readFileSync } from "node:fs";
import { chainView, parseSamples, type Samples } from "@mcmcjs/core";
import {
  type ConvergenceThresholds,
  countDivergences,
  DEFAULT_THRESHOLDS,
  diagnoseChains,
  isConverged,
  type VariableDiagnostics,
} from "@mcmcjs/diagnostics";
import type { Command } from "commander";
import pc from "picocolors";

// Sampler-stat keys that flag a divergent draw, by source format.
const DIVERGENCE_KEYS = ["numerical_error", "diverging"];

export interface VariableReport extends VariableDiagnostics {
  variable: string;
  converged: boolean;
}

export interface DiagnosticsReport {
  variables: VariableReport[];
  converged: boolean;
  thresholds: ConvergenceThresholds;
  /** Divergent draws across all chains, or null when the samples carry no divergence stat. */
  divergences: number | null;
  maxDivergences: number;
}

export interface DiagnoseOptions {
  thresholds?: ConvergenceThresholds;
  hdiProb?: number;
  maxDivergences?: number;
}

function chainsOf(samples: Samples, variable: string): Float64Array[] {
  return Array.from({ length: samples.nChains }, (_, c) => chainView(samples, variable, c));
}

function divergenceSeries(samples: Samples): Float64Array | undefined {
  for (const key of DIVERGENCE_KEYS) {
    const series = samples.sampleStats.get(key);
    if (series) return series;
  }
  return undefined;
}

/** Computes per-variable convergence diagnostics and an overall verdict. */
export function buildDiagnosticsReport(
  samples: Samples,
  options: DiagnoseOptions = {},
): DiagnosticsReport {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const maxDivergences = options.maxDivergences ?? 0;
  const variables = samples.variables.map<VariableReport>((variable) => {
    const diagnostics = diagnoseChains(chainsOf(samples, variable), options.hdiProb);
    return { variable, ...diagnostics, converged: isConverged(diagnostics, thresholds) };
  });
  const series = divergenceSeries(samples);
  const divergences = series ? countDivergences(series) : null;
  const converged =
    variables.every((v) => v.converged) && (divergences === null || divergences <= maxDivergences);
  return { variables, converged, thresholds, divergences, maxDivergences };
}

function num(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

const COLUMNS = [
  "variable",
  "mean",
  "std",
  "r_hat",
  "ess_bulk",
  "ess_tail",
  "mcse",
  "hdi",
] as const;

/** Renders the report as an aligned, monospace table. */
export function formatReportTable(report: DiagnosticsReport, color = true): string {
  const rows = report.variables.map((v) => [
    v.variable,
    num(v.mean),
    num(v.std),
    num(v.rhat),
    num(v.essBulk, 0),
    num(v.essTail, 0),
    num(v.mcseMean),
    `[${num(v.hdi[0])}, ${num(v.hdi[1])}]`,
  ]);

  const widths = COLUMNS.map((head, i) =>
    Math.max(head.length, ...rows.map((row) => (row[i] as string).length)),
  );
  const pad = (text: string, i: number) => text.padEnd(widths[i] as number);

  const header = COLUMNS.map((head, i) => pad(head, i)).join("  ");
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  const body = report.variables.map((v, ri) =>
    (rows[ri] as string[])
      .map((cell, ci) => {
        const padded = pad(cell, ci);
        return color && COLUMNS[ci] === "r_hat" && v.rhat > report.thresholds.rhatMax
          ? pc.red(padded)
          : padded;
      })
      .join("  "),
  );

  return [header, rule, ...body].join("\n");
}

/** The full human-readable report: table, divergences, and the verdict line. */
export function formatReportHuman(report: DiagnosticsReport): string {
  let out = `${formatReportTable(report)}\n\n`;
  if (report.divergences !== null) {
    const line = `divergences: ${report.divergences}`;
    out += `${report.divergences <= report.maxDivergences ? pc.green(line) : pc.red(line)}\n`;
  }
  const verdict = report.converged ? pc.green("converged") : pc.red("not converged");
  const criteria = `R-hat <= ${report.thresholds.rhatMax}, ESS >= ${report.thresholds.essMin}${report.divergences !== null ? `, divergences <= ${report.maxDivergences}` : ""}`;
  return `${out}${verdict} (${criteria})\n`;
}

function parseNumberOption(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) throw new Error(`expected a number, got "${value}"`);
  return n;
}

interface DiagnoseCliOptions {
  json?: boolean;
  rhatMax: number;
  essMin: number;
  hdiProb: number;
  maxDivergences: number;
}

export function registerDiagnose(program: Command): void {
  program
    .command("diagnose")
    .argument("<file>", "samples file (MCMCChains JSON or ArviZ InferenceData JSON)")
    .description("Check MCMC convergence diagnostics (R-hat, ESS, MCSE, HDI) for a samples file")
    .option("--json", "print the report as JSON")
    .option(
      "--rhat-max <value>",
      "maximum acceptable R-hat",
      parseNumberOption,
      DEFAULT_THRESHOLDS.rhatMax,
    )
    .option(
      "--ess-min <value>",
      "minimum acceptable ESS",
      parseNumberOption,
      DEFAULT_THRESHOLDS.essMin,
    )
    .option("--hdi-prob <value>", "HDI credible mass", parseNumberOption, 0.94)
    .option("--max-divergences <value>", "maximum acceptable divergent draws", parseNumberOption, 0)
    .addHelpText("after", "\nExit codes: 0 = converged, 1 = error, 2 = ran but not converged.")
    .action((file: string, opts: DiagnoseCliOptions) => {
      const samples = parseSamples(readFileSync(file, "utf8"));
      const report = buildDiagnosticsReport(samples, {
        thresholds: { rhatMax: opts.rhatMax, essMin: opts.essMin },
        hdiProb: opts.hdiProb,
        maxDivergences: opts.maxDivergences,
      });

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(formatReportHuman(report));
      }

      process.exitCode = report.converged ? 0 : 2;
    });
}
