import { copyFileSync, existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { type LedgerEntry, readLedger, resolveRunRef, runDir } from "@mcmcjs/core";
import type { Command } from "commander";
import { locateStore } from "./store-cli";

const KINDS = {
  samples: { file: "samples.json", suffix: ".samples.json" },
  spec: { file: "spec.toml", suffix: ".toml" },
  record: { file: "run.json", suffix: ".run.json" },
} as const;

export type ExportKind = keyof typeof KINDS;

/** The default export filename, derived from the run's model stem. */
export function defaultExportName(kind: ExportKind, entry: LedgerEntry): string {
  const model = basename(entry.model_path);
  const stem = basename(model, extname(model));
  return `${stem}${KINDS[kind].suffix}`;
}

export function registerExport(program: Command): void {
  program
    .command("export")
    .argument("<what>", "what to materialize: samples, spec, or record")
    .description("Copy a run's artifact out of the store into a visible file")
    .option("--run <ref>", "run ref: latest (default), @N, or a run-id prefix")
    .option("-o, --out <path>", "output path (default: derived from the model name)")
    .option("--force", "overwrite an existing file")
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--json", "print the result as JSON")
    .action(
      (
        what: string,
        opts: { run?: string; out?: string; force?: boolean; store?: string; json?: boolean },
      ) => {
        if (!(what in KINDS)) {
          throw new Error(`unknown export "${what}" (expected samples, spec, or record)`);
        }
        const kind = what as ExportKind;
        const storeDir = locateStore(opts.store);
        const entry = resolveRunRef(readLedger(storeDir), opts.run);
        const source = join(runDir(storeDir, entry.id), KINDS[kind].file);
        if (!existsSync(source)) {
          throw new Error(
            `run ${entry.id} has no ${KINDS[kind].file}${entry.status === "failed" ? " (the fit failed)" : ""}`,
          );
        }
        const dest = resolve(opts.out ?? defaultExportName(kind, entry));
        if (existsSync(dest) && !opts.force) {
          throw new Error(`${dest} already exists; pass --force to overwrite`);
        }
        copyFileSync(source, dest);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ run: entry.id, [kind]: dest }, null, 2)}\n`);
          return;
        }
        process.stdout.write(`exported ${kind} from run ${entry.id} to ${dest}\n`);
      },
    );
}
