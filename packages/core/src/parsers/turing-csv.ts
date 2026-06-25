import { parseCsvRows } from "../data";
import type { Samples } from "../types";

type Row = { cells: string[]; quoted: boolean };
type Layout = "wide-iteration" | "wide-export" | "long";

/** Strict numeric coercion: empty or non-finite cells become NaN (kept in place). */
function num(cell: string | undefined): number {
  const t = (cell ?? "").trim();
  if (t === "") return Number.NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : Number.NaN;
}

function detectLayout(rows: Row[]): Layout | null {
  const first = rows[0]?.cells;
  if (!first) return null;
  if (first[0] === "iteration" && first[1] === "chain") return "wide-iteration";
  if (first[0] === "chain_" && first[1] === "draw_") return "wide-export";
  // Long is headerless: exactly 4 cells, an integer iteration, and a finite value.
  if (first.length === 4) {
    const it = Number((first[2] ?? "").trim());
    const val = Number((first[3] ?? "").trim());
    if (Number.isInteger(it) && Number.isFinite(val)) return "long";
  }
  return null;
}

/** True when the text parses as one of the three Turing.jl CSV layouts. */
export function looksLikeTuringCsv(text: string): boolean {
  return detectLayout(parseCsvRows(text)) !== null;
}

/** Per-chain, per-variable value lists accumulated in first-seen order. */
interface Raw {
  chainOrder: string[];
  varOrder: string[];
  byChain: Map<string, Map<string, number[]>>;
}

function ensure(raw: Raw, chain: string, variable: string): number[] {
  if (!raw.byChain.has(chain)) {
    raw.byChain.set(chain, new Map());
    raw.chainOrder.push(chain);
  }
  if (!raw.varOrder.includes(variable)) raw.varOrder.push(variable);
  const vars = raw.byChain.get(chain) as Map<string, number[]>;
  let list = vars.get(variable);
  if (!list) {
    list = [];
    vars.set(variable, list);
  }
  return list;
}

function collectWide(rows: Row[], layout: "wide-iteration" | "wide-export"): Raw {
  const header = rows[0]?.cells ?? [];
  const chainIdx = layout === "wide-export" ? 0 : header.indexOf("chain");
  if (chainIdx < 0) throw new Error("turing csv: missing 'chain' column");
  const skip = new Set<number>(
    layout === "wide-export" ? [0, 1] : [header.indexOf("iteration"), chainIdx],
  );
  const varIdx: { name: string; col: number }[] = [];
  header.forEach((name, col) => {
    if (!skip.has(col)) varIdx.push({ name, col });
  });

  const raw: Raw = { chainOrder: [], varOrder: [], byChain: new Map() };
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]?.cells ?? [];
    if (cells.length < header.length) {
      throw new Error(
        `turing csv: row ${r + 1} has ${cells.length} cells, expected ${header.length}`,
      );
    }
    const chain = cells[chainIdx] ?? "";
    for (const { name, col } of varIdx) ensure(raw, chain, name).push(num(cells[col]));
  }
  return raw;
}

function collectLong(rows: Row[]): Raw {
  const raw: Raw = { chainOrder: [], varOrder: [], byChain: new Map() };
  for (const row of rows) {
    const cells = row.cells;
    if (cells.length < 4) continue;
    ensure(raw, cells[0] ?? "", cells[1] ?? "").push(num(cells[3]));
  }
  return raw;
}

function toSamples(raw: Raw): Samples {
  const { chainOrder, varOrder, byChain } = raw;
  const nChains = chainOrder.length;
  if (nChains === 0 || varOrder.length === 0) throw new Error("turing csv: no data rows");

  const firstChain = byChain.get(chainOrder[0] as string) as Map<string, number[]>;
  const nDraws = firstChain.get(varOrder[0] as string)?.length ?? 0;
  if (nDraws === 0) throw new Error("turing csv: no draws");

  // Samples is strictly rectangular, so reject ragged chains rather than padding.
  for (const chain of chainOrder) {
    const vars = byChain.get(chain) as Map<string, number[]>;
    for (const variable of varOrder) {
      const len = vars.get(variable)?.length ?? -1;
      if (len !== nDraws) {
        throw new Error(
          `turing csv: ragged chains (variable "${variable}" in chain "${chain}" has ${len} draws, expected ${nDraws})`,
        );
      }
    }
  }

  const draws = new Map<string, Float64Array>();
  for (const variable of varOrder) {
    const flat = new Float64Array(nChains * nDraws);
    chainOrder.forEach((chain, c) => {
      const list = (byChain.get(chain) as Map<string, number[]>).get(variable) as number[];
      flat.set(list, c * nDraws);
    });
    draws.set(variable, flat);
  }

  return { variables: varOrder, nChains, nDraws, draws, sampleStats: new Map() };
}

/**
 * Parses Turing.jl CSV output into `Samples`. Accepts the wide `iteration,chain`
 * layout, the wide `chain_,draw_` export layout, and the headerless long
 * `chain,variable,iteration,value` layout. Non-numeric cells become NaN in place
 * (unlike MCMCVisualizer, which drops them) so the result stays rectangular.
 */
export function parseTuringCsv(text: string): Samples {
  const rows = parseCsvRows(text);
  const layout = detectLayout(rows);
  if (!layout) throw new Error("turing csv: unrecognized layout");
  const raw = layout === "long" ? collectLong(rows) : collectWide(rows, layout);
  return toSamples(raw);
}
