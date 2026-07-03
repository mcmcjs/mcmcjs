import type { Samples } from "../types";

// CmdStan diagnostic columns to keep; every other `__`-suffixed column is dropped.
const STAN_DIAGNOSTIC_KEEP = new Set([
  "lp__",
  "energy__",
  "divergent__",
  "treedepth__",
  "n_leapfrog__",
  "accept_stat__",
  "stepsize__",
]);

// Diagnostics are stored under canonical keys; energy/diverging match what the
// plots package queries, the rest mirror ArviZ sample_stats naming.
const STAT_RENAME: Record<string, string> = {
  lp__: "lp",
  energy__: "energy",
  divergent__: "diverging",
  treedepth__: "tree_depth",
  n_leapfrog__: "n_steps",
  accept_stat__: "acceptance_rate",
  stepsize__: "step_size",
};

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

/** Minimal CSV line split with double-quote support; never trims cells. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

/** Scalarized `a[1,2]` -> Stan CSV `a.1.2`; names without brackets pass through. */
export function toStanName(name: string): string {
  const match = name.match(/^([^[\]]+)\[([\d,]+)\]$/);
  if (!match) return name;
  return `${match[1]}.${(match[2] ?? "").split(",").join(".")}`;
}

/** Stan `a.1.2` -> `a[1,2]`; names without all-numeric index parts pass through. */
export function fromStanName(name: string): string {
  if (!name.includes(".")) return name;
  const parts = name.split(".");
  const base = parts[0] ?? "";
  const indices = parts.slice(1);
  if (indices.length > 0 && indices.every((p) => /^\d+$/.test(p))) {
    return `${base}[${indices.join(",")}]`;
  }
  return name;
}

interface ChainColumns {
  vars: Map<string, number[]>;
  stats: Map<string, number[]>;
  nDraws: number;
}

function parseChain(text: string): ChainColumns | null {
  const dataLines = splitLines(text).filter((l) => !l.startsWith("#"));
  if (dataLines.length < 2) return null;
  const headers = parseCsvLine(dataLines[0] as string);

  const cols: { index: number; key: string; isStat: boolean }[] = [];
  headers.forEach((h, i) => {
    if (h.endsWith("__")) {
      if (STAN_DIAGNOSTIC_KEEP.has(h))
        cols.push({ index: i, key: STAT_RENAME[h] ?? h, isStat: true });
    } else {
      cols.push({ index: i, key: fromStanName(h), isStat: false });
    }
  });

  const vars = new Map<string, number[]>();
  const stats = new Map<string, number[]>();
  for (const col of cols) (col.isStat ? stats : vars).set(col.key, []);

  let nDraws = 0;
  for (let r = 1; r < dataLines.length; r++) {
    const fields = parseCsvLine(dataLines[r] as string);
    if (fields.length < headers.length) continue; // drop ragged rows, as CmdStan never emits them
    for (const col of cols) {
      const v = Number(fields[col.index] ?? "");
      (col.isStat ? stats : vars).get(col.key)?.push(Number.isFinite(v) ? v : Number.NaN);
    }
    nDraws++;
  }
  if (nDraws === 0) return null;
  return { vars, stats, nDraws };
}

/** Parses one or more CmdStan CSV files (one per chain) into `Samples`. */
export function fromStanCSVFiles(texts: string[]): Samples {
  const chains: ChainColumns[] = [];
  for (const text of texts) {
    const c = parseChain(text);
    if (!c) throw new Error("stan csv: a chain has no usable data rows");
    chains.push(c);
  }
  if (chains.length === 0) throw new Error("stan csv: no input files");

  const first = chains[0] as ChainColumns;
  const nDraws = first.nDraws;
  const varNames = [...first.vars.keys()];
  const statNames = [...first.stats.keys()];
  for (const c of chains) {
    if (c.nDraws !== nDraws) throw new Error("stan csv: chains have differing draw counts");
    if (c.vars.size !== varNames.length || varNames.some((v) => !c.vars.has(v))) {
      throw new Error("stan csv: chains have differing variables");
    }
  }

  const nChains = chains.length;
  const layout = (names: string[], pick: (c: ChainColumns) => Map<string, number[]>) => {
    const map = new Map<string, Float64Array>();
    for (const name of names) {
      const flat = new Float64Array(nChains * nDraws);
      chains.forEach((c, ci) => {
        const list = pick(c).get(name);
        if (list) flat.set(list, ci * nDraws);
      });
      map.set(name, flat);
    }
    return map;
  };

  return {
    variables: varNames,
    nChains,
    nDraws,
    draws: layout(varNames, (c) => c.vars),
    sampleStats: layout(statNames, (c) => c.stats),
  };
}

/** Parses a single CmdStan CSV file into `Samples`. */
export function fromStanCSV(text: string): Samples {
  return fromStanCSVFiles([text]);
}
