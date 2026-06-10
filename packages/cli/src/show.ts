import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type LedgerEntry, type RunRecord, readLedger, resolveRunRef, runDir } from "@mcmcjs/core";
import type { Command } from "commander";
import pc from "picocolors";
import { locateStore, timeAgo } from "./store-cli";

const ARTIFACTS = ["samples.json", "run.json", "spec.toml"] as const;

function readRecord(dir: string): RunRecord | undefined {
  const path = join(dir, "run.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RunRecord;
  } catch {
    return undefined;
  }
}

/** Renders one run's full detail for the terminal. */
export function formatRunDetail(
  entry: LedgerEntry,
  dir: string,
  record: RunRecord | undefined,
): string {
  const s = entry.sampler;
  const lines: string[] = [];
  const row = (label: string, value: string) => lines.push(`${label.padEnd(10)}${value}`);

  lines.push(`run ${entry.id}`);
  row(
    "model",
    `${entry.model_path}${entry.model_sha256 ? ` (sha256 ${entry.model_sha256.slice(0, 12)})` : ""}`,
  );
  row(
    "backend",
    `${entry.backend.id} on Julia ${entry.backend.version}${entry.julia ? ` (ran ${entry.julia})` : ""}`,
  );
  row(
    "sampler",
    `${s.algorithm}, ${s.chains} chains x ${s.draws} draws + ${s.warmup} warmup, adapt_delta ${s.adapt_delta}, seed ${entry.seed}`,
  );
  row("data", `sha256 ${entry.data_sha256.slice(0, 12)}`);
  if (entry.status === "failed") {
    row("status", pc.red(`failed${entry.error ? `: ${entry.error}` : ""}`));
  } else if (entry.diagnostics) {
    const d = entry.diagnostics;
    const detail = [
      d.rhat_max !== null ? `R-hat max ${d.rhat_max.toFixed(3)}` : null,
      d.ess_bulk_min !== null ? `ESS bulk min ${Math.round(d.ess_bulk_min)}` : null,
      d.divergences !== null ? `divergences ${d.divergences}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const verdict = d.converged ? pc.green("converged") : pc.red("not converged");
    row("status", `ok, ${verdict}${detail ? ` (${detail})` : ""}`);
  } else {
    row("status", "ok");
  }
  row(
    "started",
    `${entry.started_at} (${timeAgo(entry.started_at)}, ${(entry.elapsed_ms / 1000).toFixed(1)} s)`,
  );
  if (record?.packages && Object.keys(record.packages).length > 0) {
    row(
      "packages",
      Object.entries(record.packages)
        .map(([name, version]) => `${name} ${version}`)
        .join(", "),
    );
  }
  const present = ARTIFACTS.filter((name) => existsSync(join(dir, name)));
  if (present.length > 0) {
    row("artifacts", join(dir, present[0] as string));
    for (const name of present.slice(1)) row("", join(dir, name));
  }
  return lines.join("\n");
}

export function registerShow(program: Command): void {
  program
    .command("show")
    .argument("[ref]", "run ref: latest (default), @N, or a run-id prefix")
    .description("Show one run's settings, provenance, and artifacts")
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--json", "print the entry, record, and paths as JSON")
    .action((ref: string | undefined, opts: { store?: string; json?: boolean }) => {
      const storeDir = locateStore(opts.store);
      const entry = resolveRunRef(readLedger(storeDir), ref);
      const dir = runDir(storeDir, entry.id);
      const record = readRecord(dir);
      if (opts.json) {
        const artifacts = Object.fromEntries(
          ARTIFACTS.filter((name) => existsSync(join(dir, name))).map((name) => [
            name.replace(/\..*$/, ""),
            join(dir, name),
          ]),
        );
        process.stdout.write(`${JSON.stringify({ entry, record, artifacts }, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${formatRunDetail(entry, dir, record)}\n`);
    });
}
