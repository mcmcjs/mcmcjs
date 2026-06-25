import { dropWarmup, parseSamples, type Samples } from "@mcmcjs/core";
import type { Command } from "commander";
import { buildDiagnosticsReport, resolveSamplesText } from "./diagnose";
import { parseIntOption } from "./options";

interface SummaryCliOptions {
  json?: boolean;
  store?: string;
  stdin?: boolean;
  warmup?: number;
  var?: string[];
}

const COLUMNS = [
  "variable",
  "mean",
  "std",
  "mcse",
  "ess_bulk",
  "ess_tail",
  "r_hat",
  "hdi",
] as const;

export interface SummaryRow {
  variable: string;
  mean: number;
  std: number;
  mcse: number;
  ess_bulk: number;
  ess_tail: number;
  r_hat: number;
  hdi: [number, number];
}

/** Builds the summary rows for a samples object, optionally filtered to `vars`. */
export function buildSummaryRows(samples: Samples, vars?: readonly string[]): SummaryRow[] {
  const keep = vars ? new Set(vars) : undefined;
  return buildDiagnosticsReport(samples)
    .variables.filter((v) => !keep || keep.has(v.variable))
    .map<SummaryRow>((v) => ({
      variable: v.variable,
      mean: v.mean,
      std: v.std,
      mcse: v.mcseMean,
      ess_bulk: v.essBulk,
      ess_tail: v.essTail,
      r_hat: v.rhat,
      hdi: v.hdi,
    }));
}

function num(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

/** Renders the summary rows as an aligned, monospace stats table. */
export function formatSummaryTable(rows: SummaryRow[]): string {
  const cells = rows.map((r) => [
    r.variable,
    num(r.mean),
    num(r.std),
    num(r.mcse),
    num(r.ess_bulk, 0),
    num(r.ess_tail, 0),
    num(r.r_hat),
    `[${num(r.hdi[0])}, ${num(r.hdi[1])}]`,
  ]);

  const widths = COLUMNS.map((head, i) =>
    Math.max(head.length, ...cells.map((row) => (row[i] ?? "").length)),
  );
  const pad = (text: string, i: number) => text.padEnd(widths[i] ?? 0);

  const header = COLUMNS.map((head, i) => pad(head, i)).join("  ");
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  const body = cells.map((row) => row.map((cell, ci) => pad(cell, ci)).join("  "));

  return [header, rule, ...body].join("\n");
}

export function registerSummary(program: Command): void {
  program
    .command("summary")
    .summary("posterior summary statistics for a samples file")
    .helpGroup("Inspect runs:")
    .argument(
      "[target]",
      "samples file (MCMCChains JSON or ArviZ InferenceData JSON), or a run ref (latest, @N, id prefix); default: the latest store run",
    )
    .description(
      "Print a posterior summary table (mean, std, mcse, ess_bulk, ess_tail, r_hat, hdi) for a samples file",
    )
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--stdin", "read the samples from stdin instead of a file/run ref")
    .option(
      "--warmup <n>",
      "discard the first n draws of each chain before computing",
      parseIntOption,
    )
    .option("--var <name...>", "restrict to these variables (default: all)")
    .option("--json", "print the rows as JSON")
    .action((target: string | undefined, opts: SummaryCliOptions) => {
      if (opts.warmup !== undefined && opts.warmup < 0) {
        throw new Error("--warmup must be a non-negative integer");
      }
      let samples = parseSamples(resolveSamplesText(target, opts));
      if (opts.warmup !== undefined) samples = dropWarmup(samples, opts.warmup);

      const rows = buildSummaryRows(samples, opts.var);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatSummaryTable(rows)}\n`);
      }
    });
}
