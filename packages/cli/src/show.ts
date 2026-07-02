import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type LedgerEntry, type RunRecord, readLedger, resolveRunRef, runDir } from "@mcmcjs/core";
import type { Command } from "commander";
import pc from "picocolors";
import { locateStore, timeAgo } from "./store-cli";

/** Artifact files a run dir may hold, keyed for --json output. */
function artifactFiles(entry: LedgerEntry): Array<{ key: string; file: string }> {
  return [
    { key: "samples", file: "samples.json" },
    { key: "record", file: "run.json" },
    { key: "spec", file: "spec.toml" },
    { key: "model", file: basename(entry.model_path) },
  ];
}

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
    `${entry.backend.id} on ${entry.backend.id === "stan" ? "CmdStan" : "Julia"} ${entry.backend.version}${entry.julia ? ` (ran ${entry.julia})` : ""}`,
  );
  row(
    "sampler",
    `${s.algorithm}, ${s.chains} chains x ${s.draws} draws + ${s.warmup} warmup, adapt_delta ${s.adapt_delta}, seed ${entry.seed}`,
  );
  row("data", `sha256 ${entry.data_sha256.slice(0, 12)}`);
  if (entry.status === "failed") {
    row("status", pc.red(`failed${entry.error ? `: ${entry.error}` : ""}`));
  } else if (entry.status === "cancelled") {
    row("status", pc.yellow("cancelled"));
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
  const present = artifactFiles(entry).filter(({ file }) => existsSync(join(dir, file)));
  if (present.length > 0) {
    row("artifacts", join(dir, (present[0] as { file: string }).file));
    for (const { file } of present.slice(1)) row("", join(dir, file));
  }
  return lines.join("\n");
}

export function registerShow(program: Command): void {
  program
    .command("show")
    .summary("show one run's settings and artifacts")
    .helpGroup("Inspect runs:")
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
          artifactFiles(entry)
            .filter(({ file }) => existsSync(join(dir, file)))
            .map(({ key, file }) => [key, join(dir, file)]),
        );
        process.stdout.write(`${JSON.stringify({ entry, record, artifacts }, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${formatRunDetail(entry, dir, record)}\n`);
    });
}
