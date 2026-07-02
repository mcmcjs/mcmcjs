import { closeSync, openSync, readSync } from "node:fs";
import { fromStanName } from "@mcmcjs/core";
import type { DrawBatch } from "@mcmcjs/engine";

// Mirrors the sampler-column renames applied by @mcmcjs/core's Stan CSV parser
// (packages/core/src/parsers/stan.ts) so streamed leaves match the samples file.
const STAT_RENAME: Record<string, string> = {
  lp__: "lp",
  energy__: "energy",
  divergent__: "diverging",
  treedepth__: "tree_depth",
  n_leapfrog__: "n_steps",
  accept_stat__: "acceptance_rate",
  stepsize__: "step_size",
};

/** Stan CSV column -> streamed leaf name; null for dropped diagnostic columns. */
export function columnToLeaf(column: string): string | null {
  if (column.endsWith("__")) return STAT_RENAME[column] ?? null;
  return fromStanName(column);
}

/** CmdStan prints C++ formatting for non-finite doubles: inf, -inf, nan. */
function parseStanNumber(field: string): number {
  const value = Number(field);
  if (!Number.isNaN(value) || field === "nan") return value;
  if (field === "inf" || field === "+inf") return Number.POSITIVE_INFINITY;
  if (field === "-inf") return Number.NEGATIVE_INFINITY;
  return value;
}

export interface StanCsvTail {
  /** Reads newly appended rows and emits any full batches. */
  poll(): void;
  /** Final poll plus a flush of the remaining partial batch. */
  finish(): void;
}

/**
 * Incrementally tails one growing CmdStan CSV, batching completed draws into
 * DrawBatch messages. Comment lines (the config echo, adaptation block, and
 * timing footer) are skipped; the first non-comment line is the header. A
 * trailing line without its newline is left buffered until it completes, and a
 * row is only accepted when its field count matches the header.
 */
export function createStanCsvTail(
  filePath: string,
  opts: {
    /** 0-based chain index reported in batches. */
    chain: number;
    /** Draws per batch. */
    batchSize: number;
    onBatch: (batch: DrawBatch) => void;
  },
): StanCsvTail {
  let position = 0;
  let pending = "";
  let leaves: (string | null)[] | undefined;
  let seq = 0;
  const rows: number[][] = [];

  const emit = (count: number) => {
    if (count === 0 || !leaves) return;
    const draws: Record<string, number[]> = {};
    for (let c = 0; c < leaves.length; c++) {
      const leaf = leaves[c];
      if (!leaf) continue;
      const values = new Array<number>(count);
      for (let r = 0; r < count; r++) values[r] = rows[r]?.[c] ?? Number.NaN;
      draws[leaf] = values;
    }
    rows.splice(0, count);
    opts.onBatch({ chain: opts.chain, seq, iteration: null, draws });
    seq += 1;
  };

  const consume = (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return;
    if (!leaves) {
      leaves = trimmed.split(",").map(columnToLeaf);
      return;
    }
    const fields = trimmed.split(",");
    if (fields.length !== leaves.length) return;
    rows.push(fields.map(parseStanNumber));
    if (rows.length >= opts.batchSize) emit(opts.batchSize);
  };

  const poll = () => {
    let fd: number;
    try {
      fd = openSync(filePath, "r");
    } catch {
      return; // not created yet
    }
    try {
      const chunk = Buffer.alloc(1 << 16);
      for (;;) {
        const read = readSync(fd, chunk, 0, chunk.length, position);
        if (read <= 0) break;
        position += read;
        pending += chunk.toString("utf8", 0, read);
        for (;;) {
          const nl = pending.indexOf("\n");
          if (nl < 0) break;
          consume(pending.slice(0, nl));
          pending = pending.slice(nl + 1);
        }
      }
    } finally {
      closeSync(fd);
    }
  };

  return {
    poll,
    finish() {
      poll();
      emit(rows.length);
    },
  };
}
