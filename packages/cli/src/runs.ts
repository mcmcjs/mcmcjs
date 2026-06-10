import { rmSync } from "node:fs";
import {
  type Ledger,
  type LedgerEntry,
  readLedger,
  removeLedgerEntries,
  runDir,
} from "@mcmcjs/core";
import type { Command } from "commander";
import pc from "picocolors";
import { locateStore, timeAgo } from "./store-cli";

function verdictOf(entry: LedgerEntry): string {
  if (entry.status === "failed") return "failed";
  if (!entry.diagnostics) return "-";
  return entry.diagnostics.converged ? "converged" : "not converged";
}

function colorVerdict(text: string, color: boolean): string {
  if (!color) return text;
  if (text.startsWith("converged")) return pc.green(text);
  if (text.startsWith("failed") || text.startsWith("not converged")) return pc.red(text);
  return text;
}

const RUNS_COLUMNS = ["ref", "run", "model", "sampler", "seed", "verdict", "div", "when", "took"];
const VERDICT_COLUMN = RUNS_COLUMNS.indexOf("verdict");

/** Renders the ledger as an aligned table, newest first. */
export function formatRunsTable(ledger: Ledger, color = true): string {
  if (ledger.runs.length === 0) {
    return "no runs yet; run `mcmc run <model>` first";
  }
  const rows = [...ledger.runs]
    .reverse()
    .map((entry, i) => [
      `@${i + 1}`,
      entry.id,
      entry.model_path,
      `${entry.sampler.draws}x${entry.sampler.chains}`,
      String(entry.seed),
      verdictOf(entry),
      entry.diagnostics?.divergences === null || entry.diagnostics === undefined
        ? "-"
        : String(entry.diagnostics.divergences),
      timeAgo(entry.started_at),
      `${(entry.elapsed_ms / 1000).toFixed(1)}s`,
    ]);
  const widths = RUNS_COLUMNS.map((head, i) =>
    Math.max(head.length, ...rows.map((row) => (row[i] as string).length)),
  );
  const pad = (text: string, i: number) => text.padEnd(widths[i] as number);
  const lines = [
    RUNS_COLUMNS.map((head, i) => pad(head, i)).join("  "),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...rows.map((row) =>
      row
        .map((cell, i) => (i === VERDICT_COLUMN ? colorVerdict(pad(cell, i), color) : pad(cell, i)))
        .join("  "),
    ),
  ];
  return lines.join("\n");
}

/** Picks the oldest runs beyond `keep`, failed runs first, for pruning. */
export function pruneSelection(ledger: Ledger, keep: number): LedgerEntry[] {
  if (keep < 0) throw new Error("--keep must be >= 0");
  const excess = ledger.runs.length - keep;
  if (excess <= 0) return [];
  const oldestFirst = [...ledger.runs];
  const failed = oldestFirst.filter((r) => r.status === "failed");
  const ok = oldestFirst.filter((r) => r.status === "ok");
  return [...failed, ...ok].slice(0, excess);
}

function parseIntOption(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) throw new Error(`expected an integer, got "${value}"`);
  return n;
}

export function registerRuns(program: Command): void {
  const runs = program
    .command("runs")
    .description("List and manage the runs recorded in the project store");

  runs
    .command("list", { isDefault: true })
    .description("List runs, newest first")
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--json", "print the raw ledger entries as JSON")
    .action((opts: { store?: string; json?: boolean }) => {
      const ledger = readLedger(locateStore(opts.store));
      if (opts.json) {
        process.stdout.write(`${JSON.stringify([...ledger.runs].reverse(), null, 2)}\n`);
        return;
      }
      process.stdout.write(`${formatRunsTable(ledger)}\n`);
    });

  runs
    .command("prune")
    .description("Delete old runs, keeping the most recent ones")
    .requiredOption("--keep <n>", "number of most recent runs to keep", parseIntOption)
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--json", "print the pruned run ids as JSON")
    .action((opts: { keep: number; store?: string; json?: boolean }) => {
      const storeDir = locateStore(opts.store);
      const selection = pruneSelection(readLedger(storeDir), opts.keep);
      const removed = removeLedgerEntries(storeDir, new Set(selection.map((r) => r.id)));
      for (const entry of removed) {
        rmSync(runDir(storeDir, entry.id), { recursive: true, force: true });
      }
      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify(
            removed.map((r) => r.id),
            null,
            2,
          )}\n`,
        );
        return;
      }
      process.stdout.write(
        removed.length === 0
          ? "nothing to prune\n"
          : `pruned ${removed.length} run${removed.length === 1 ? "" : "s"}\n`,
      );
    });
}
