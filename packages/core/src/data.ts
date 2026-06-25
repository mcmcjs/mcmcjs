import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

/**
 * The canonical model-data shape: a flat object keyed by variable name, whose
 * values are finite numbers or row-major rectangular nested numeric arrays
 * (e.g. `{ N: 10, y: [0.2, -1.1], x: [[1, 2], [3, 4]] }`). This is the same
 * language-neutral JSON a Stan model reads into its data block, and the shape
 * a single file feeds to every backend unchanged.
 */
export type CanonicalArray = (number | CanonicalArray)[];
export type CanonicalValue = number | CanonicalArray;
export type CanonicalData = Record<string, CanonicalValue>;

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "object") return "an object";
  return String(value);
}

/** Dimensions of a value: [] for a scalar, [n, ...inner] for an array. */
function shapeOf(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [value.length, ...(value.length > 0 ? shapeOf(value[0]) : [])];
}

function validateValue(value: unknown, where: string, source: string): void {
  if (value === null || value === undefined) {
    throw new Error(
      `${where} in ${source} is ${describe(value)}; canonical data cannot contain missing values`,
    );
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `${where} in ${source} is ${value}; canonical data values must be finite numbers`,
      );
    }
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `${where} in ${source} is ${describe(value)}; canonical data values must be numbers or nested numeric arrays`,
    );
  }
  const shapes = value.map(shapeOf);
  value.forEach((element, i) => {
    validateValue(element, `${where}[${i}]`, source);
    if (i > 0 && shapes[i]?.join() !== shapes[0]?.join()) {
      throw new Error(
        `${where} in ${source} is ragged: element ${i} has shape [${shapes[i]}] but [${shapes[0]}] was expected`,
      );
    }
  });
}

/** Throws unless `data` is a canonical, finite, rectangular numeric data object. */
export function validateCanonicalData(
  data: Record<string, unknown>,
  source = "data",
): CanonicalData {
  for (const [key, value] of Object.entries(data)) {
    validateValue(value, key, source);
  }
  return data as CanonicalData;
}

// Minimal RFC-4180 CSV reader: quoted fields, escaped quotes, CRLF. Tracks
// whether a row used quotes so a quoted empty field is not mistaken for a
// blank line.
export function parseCsvRows(text: string): { cells: string[]; quoted: boolean }[] {
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

/** CSV columns become numeric arrays keyed by header; N defaults to the row count. */
function fromCsv(text: string, source: string): CanonicalData {
  const rows = parseCsvRows(text);
  const header = rows[0]?.cells;
  if (!header || header.length === 0) throw new Error(`empty CSV ${source}: expected a header row`);
  const keys = header.map((name, c) => {
    const key = name.trim();
    if (!key) throw new Error(`CSV column ${c + 1} of ${source} has an empty header`);
    return key;
  });
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) throw new Error(`duplicate CSV column "${key}" in ${source}`);
    seen.add(key);
  }

  const body = rows.slice(1);
  const data: CanonicalData = {};
  keys.forEach((key, c) => {
    data[key] = body.map((r, i) => {
      if (r.cells.length !== keys.length) {
        throw new Error(
          `row ${i + 2} of ${source} has ${r.cells.length} cells, expected ${keys.length}`,
        );
      }
      const cell = (r.cells[c] as string).trim();
      if (!NUMERIC.test(cell)) {
        const what = cell === "" ? "is empty" : `"${cell}" is not numeric`;
        throw new Error(
          `column "${key}" at row ${i + 2} of ${source}: ${what}; canonical data is numeric`,
        );
      }
      return Number(cell);
    });
  });
  // Models often loop over 1:N; provide the row count unless the file has its own N.
  if (!("N" in data)) data.N = body.length;
  return data;
}

/**
 * Loads a model-data file into canonical form. JSON objects map verbatim and
 * are validated; CSV columns become numeric arrays keyed by header (with N
 * defaulting to the row count). Non-numeric, missing, or ragged values throw.
 */
export function loadDataFile(path: string): CanonicalData {
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
    return validateCanonicalData(parsed as Record<string, unknown>, path);
  }
  if (ext === ".csv") return fromCsv(text, path);
  throw new Error(`unsupported data file extension (expected .json or .csv): ${path}`);
}

export interface ResolvedData {
  /** The canonical data passed to the model (loaded from the file, or inline). */
  data: CanonicalData;
  /** The source file path, when the data came from a referenced file. */
  dataFile?: string;
  /** sha256 of the file's bytes, when file-referenced (recorded in place of inlining). */
  dataSha256?: string;
}

/**
 * Resolves a run's data: the contents of `filePath` when given (a reference,
 * also hashed by its bytes so the run records the reference rather than a copy),
 * otherwise the inline table. Either way the result is validated canonical data.
 */
export function resolveData(inline: Record<string, unknown>, filePath?: string): ResolvedData {
  if (!filePath) return { data: validateCanonicalData(inline) };
  const dataSha256 = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  return { data: loadDataFile(filePath), dataFile: filePath, dataSha256 };
}
