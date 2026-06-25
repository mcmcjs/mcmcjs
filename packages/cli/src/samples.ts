import { writeFileSync } from "node:fs";
import { dropWarmup, parseSamples, toChainArrays, toMCMCChainsJson } from "@mcmcjs/core";
import type { Command } from "commander";
import { resolveSamplesText } from "./diagnose";
import { parseIntOption } from "./options";

const FORMATS = ["json", "mcmcchains-json"] as const;
type SamplesFormat = (typeof FORMATS)[number];

interface SamplesCliOptions {
  to: string;
  store?: string;
  stdin?: boolean;
  warmup?: number;
  out?: string;
}

export function registerSamples(program: Command): void {
  program
    .command("samples")
    .summary("export the raw draws in a portable format")
    .helpGroup("Inspect runs:")
    .argument(
      "[target]",
      "samples file (MCMCChains JSON or ArviZ InferenceData JSON), or a run ref (latest, @N, id prefix); default: the latest store run",
    )
    .description(
      "Export the raw posterior draws as chain-major JSON (json) or MCMCChains JSON (mcmcchains-json)",
    )
    .option("--to <format>", `output format: ${FORMATS.join(" | ")}`, "json")
    .option("--store <dir>", "run store directory (default: nearest .mcmc above cwd)")
    .option("--stdin", "read the samples from stdin instead of a file/run ref")
    .option(
      "--warmup <n>",
      "discard the first n draws of each chain before exporting",
      parseIntOption,
    )
    .option("-o, --out <file>", "write the export to a file instead of stdout")
    .action((target: string | undefined, opts: SamplesCliOptions) => {
      const to = opts.to as SamplesFormat;
      if (!FORMATS.includes(to)) {
        throw new Error(`unknown --to "${opts.to}"; expected one of: ${FORMATS.join(", ")}`);
      }
      if (opts.warmup !== undefined && opts.warmup < 0) {
        throw new Error("--warmup must be a non-negative integer");
      }
      let samples = parseSamples(resolveSamplesText(target, opts));
      if (opts.warmup !== undefined) samples = dropWarmup(samples, opts.warmup);

      const payload = to === "mcmcchains-json" ? toMCMCChainsJson(samples) : toChainArrays(samples);
      const out = `${JSON.stringify(payload, null, 2)}\n`;
      if (opts.out) {
        writeFileSync(opts.out, out);
        process.stdout.write(`wrote ${to} to ${opts.out}\n`);
      } else {
        process.stdout.write(out);
      }
    });
}
