import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

// Minimal RFC-4180 CSV reader: quoted fields, escaped quotes, CRLF. Tracks
// whether a row used quotes so a quoted empty field is not mistaken for a
// blank line.
function parseCsv(text: string): { cells: string[]; quoted: boolean }[] {
  const rows: { cells: string[]; quoted: boolean }[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawQuote = false;
  const pushRow = () => {
    row.push(field);
    field = "";
    rows.push({ cells: row, quoted: sawQuote });
    row = [];
    sawQuote = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
      sawQuote = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0 || sawQuote) pushRow();
  return rows.filter((r) => !(r.cells.length === 1 && r.cells[0] === "" && !r.quoted));
}

const NUMERIC = /^[+-]?(?:\d+\.?\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$/;

function coerce(cell: string): number | string {
  const s = cell.trim();
  return NUMERIC.test(s) ? Number(s) : s;
}

function fromCsv(text: string, path: string): Record<string, unknown> {
  const rows = parseCsv(text);
  const header = rows[0]?.cells;
  if (!header || header.length === 0) throw new Error(`empty CSV ${path}: expected a header row`);
  const keys = header.map((name, c) => {
    const key = name.trim();
    if (!key) throw new Error(`CSV column ${c + 1} of ${path} has an empty header`);
    return key;
  });
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) throw new Error(`duplicate CSV column "${key}" in ${path}`);
    seen.add(key);
  }

  const body = rows.slice(1);
  const data: Record<string, unknown> = {};
  keys.forEach((key, c) => {
    data[key] = body.map((r, i) => {
      if (r.cells.length !== keys.length) {
        throw new Error(
          `row ${i + 2} of ${path} has ${r.cells.length} cells, expected ${keys.length}`,
        );
      }
      const cell = (r.cells[c] as string).trim();
      if (cell === "") {
        throw new Error(
          `empty cell in column "${key}" at row ${i + 2} of ${path}; the spec's TOML data cannot represent missing values`,
        );
      }
      return coerce(cell);
    });
  });
  // BUGS-style models loop over 1:N; provide the row count unless the file has its own N.
  if (!("N" in data)) data.N = body.length;
  return data;
}

function rejectNulls(value: unknown, where: string, path: string): void {
  if (value === null || value === undefined) {
    throw new Error(
      `null value at ${where} in ${path}; the spec's TOML data cannot represent missing values`,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      rejectNulls(v, `${where}[${i}]`, path);
    });
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      rejectNulls(v, `${where}.${k}`, path);
    }
  }
}

/**
 * Loads a model-data file into the spec's [data] table. JSON objects map
 * verbatim; CSV columns become vectors keyed by header (numeric-looking cells
 * coerced to numbers), with N defaulting to the row count. Missing values
 * (nulls, empty cells) are rejected: TOML cannot represent them.
 */
export function loadDataFile(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const ext = extname(path).toLowerCase();
  if (ext === ".json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`invalid JSON in ${path}: ${err instanceof Error ? err.message : err}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`data file ${path} must be a JSON object of name/value pairs`);
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      rejectNulls(v, k, path);
    }
    return parsed as Record<string, unknown>;
  }
  if (ext === ".csv") return fromCsv(text, path);
  throw new Error(`unsupported data file extension (expected .json or .csv): ${path}`);
}

export interface ResolvedData {
  /** The data passed to the model (loaded from the file, or the inline table). */
  data: Record<string, unknown>;
  /** The source file path, when the data came from a referenced file. */
  dataFile?: string;
  /** sha256 of the file's bytes, when file-referenced (recorded in place of inlining). */
  dataSha256?: string;
}

/**
 * Resolves a run's data: the contents of `filePath` when given (a reference,
 * also hashed by its bytes so the run records the reference rather than a copy),
 * otherwise the inline table.
 */
export function resolveData(inline: Record<string, unknown>, filePath?: string): ResolvedData {
  if (!filePath) return { data: inline };
  const dataSha256 = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  return { data: loadDataFile(filePath), dataFile: filePath, dataSha256 };
}
