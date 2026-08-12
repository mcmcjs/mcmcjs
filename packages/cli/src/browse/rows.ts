import { basename } from "node:path";
import { chainView, type LedgerEntry, type Samples } from "@mcmcjs/core";
import { verdictOf } from "../runs";
import { timeAgo } from "../store-cli";
import { buildSummaryRows } from "../summary";

export interface RunItem {
  kind: "run";
  /** The short ref the other commands accept, e.g. "@3". */
  ref: string;
  entry: LedgerEntry;
}

export interface ModelItem {
  kind: "model";
  path: string;
  /** Path as shown, relative to the project root. */
  label: string;
  language: string;
  runs: number;
}

export type BrowseItem = RunItem | ModelItem;

export type Tone = "good" | "bad" | "warn" | "plain";

export interface Row {
  label: string;
  hint: string;
  tone: Tone;
}

/** A row bound to the value it selects. */
export interface Pickable<T> {
  row: Row;
  value: T;
  /** Lowercased text the filter matches against. */
  search: string;
}

export function toneOf(verdict: string): Tone {
  if (verdict.startsWith("converged")) return "good";
  if (verdict.startsWith("cancelled")) return "warn";
  if (verdict.startsWith("failed") || verdict.startsWith("not converged")) return "bad";
  return "plain";
}

function widest(values: readonly string[]): number {
  return values.reduce((max, value) => Math.max(max, value.length), 0);
}

/** Run rows, with the ref and model columns padded to line up. */
export function runPickables(items: readonly RunItem[], nowMs = Date.now()): Pickable<RunItem>[] {
  const refWidth = widest(items.map((item) => item.ref));
  const modelWidth = widest(items.map((item) => item.entry.model_path));
  return items.map((item) => {
    const { entry, ref } = item;
    const verdict = verdictOf(entry);
    const sampler = `${entry.sampler.algorithm} ${entry.sampler.draws}x${entry.sampler.chains}`;
    return {
      value: item,
      row: {
        label: `${ref.padEnd(refWidth)}  ${entry.model_path.padEnd(modelWidth)}  ${sampler}`,
        hint: `${verdict} · ${timeAgo(entry.started_at, nowMs)}`,
        tone: toneOf(verdict),
      },
      search:
        `${ref} ${entry.id} ${entry.model_path} ${entry.sampler.algorithm} ${entry.backend.id} ${verdict}`.toLowerCase(),
    };
  });
}

export function modelPickables(items: readonly ModelItem[]): Pickable<ModelItem>[] {
  const width = widest(items.map((item) => item.label));
  return items.map((item) => ({
    value: item,
    row: {
      label: item.label.padEnd(width),
      hint: `${item.language} · ${item.runs === 1 ? "1 run" : `${item.runs} runs`}`,
      tone: "plain" as const,
    },
    search: `${item.label} ${item.language}`.toLowerCase(),
  }));
}

/** Every whitespace-separated term must appear; matching is case-insensitive. */
export function matches(search: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => search.includes(term));
}

export function filterPickables<T>(items: readonly Pickable<T>[], query: string): Pickable<T>[] {
  if (!query.trim()) return [...items];
  return items.filter((item) => matches(item.search, query));
}

const BLOCKS = "▁▂▃▄▅▆▇█";

/**
 * A one-line trace of `values`, averaged into `width` buckets. A flat series
 * renders as the lowest block, which is what a stuck chain should look like.
 */
export function sparkline(values: readonly number[], width = 24): string {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0 || width <= 0) return "";
  const buckets = Math.min(width, finite.length);
  const means: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const from = Math.floor((i * finite.length) / buckets);
    const to = Math.max(from + 1, Math.floor(((i + 1) * finite.length) / buckets));
    let sum = 0;
    for (let k = from; k < to; k++) sum += finite[k] as number;
    means.push(sum / (to - from));
  }
  const lo = Math.min(...means);
  const hi = Math.max(...means);
  const span = hi - lo;
  return means
    .map((m) => {
      const at = span > 0 ? Math.round(((m - lo) / span) * (BLOCKS.length - 1)) : 0;
      return BLOCKS[at] ?? BLOCKS[0];
    })
    .join("");
}

export interface VariableRow {
  variable: string;
  mean: number;
  std: number;
  rhat: number;
  essBulk: number;
  /** Chain 0's trace, for a glance at mixing. */
  spark: string;
}

export function variableRows(samples: Samples, sparkWidth = 20): VariableRow[] {
  return buildSummaryRows(samples).map((row) => ({
    variable: row.variable,
    mean: row.mean,
    std: row.std,
    rhat: row.r_hat,
    essBulk: row.ess_bulk,
    spark: sparkline(Array.from(chainView(samples, row.variable, 0)) as number[], sparkWidth),
  }));
}

export function variablePickables(rows: readonly VariableRow[]): Pickable<VariableRow>[] {
  const width = widest(rows.map((row) => row.variable));
  const stat = (value: number, digits = 3) =>
    Number.isFinite(value) ? value.toFixed(digits) : "n/a";
  return rows.map((row) => ({
    value: row,
    row: {
      label: `${row.variable.padEnd(width)}  ${row.spark}`,
      hint: `mean ${stat(row.mean)} · sd ${stat(row.std)} · R-hat ${stat(row.rhat)} · ESS ${stat(row.essBulk, 0)}`,
      tone: (Number.isFinite(row.rhat) && row.rhat > 1.01 ? "bad" : "plain") as Tone,
    },
    search: row.variable.toLowerCase(),
  }));
}

/** The language label shown for a model file, from its extension. */
export function languageOf(path: string): string {
  const name = basename(path).toLowerCase();
  if (name.endsWith(".stan")) return "stan";
  if (name.endsWith(".jl")) return "julia";
  if (name.endsWith(".json") || name.endsWith(".toml")) return "spec";
  return "model";
}
