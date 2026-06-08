import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseSpec } from "@mcmcjs/core";
import { createFitRunner, createRunner, type EngineContext } from "@mcmcjs/engine";
import { ensureProject, managedProjectDir, resolveVersion, runFit } from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";
import { juliaupBin } from "./julia";

const INSTALL_TIMEOUT_MS = 30 * 60_000;

function defaultOut(specPath: string): string {
  const dir = dirname(specPath);
  const base = basename(specPath, extname(specPath));
  return join(dir, `${base}.samples.json`);
}

export function registerFit(program: Command, ctx: EngineContext): void {
  program
    .command("fit")
    .argument("<spec>", "inference spec file (TOML or JSON)")
    .description("Run MCMC inference for a spec and write a samples file")
    .option("-o, --out <file>", "samples output path")
    .option("--julia-version <channel>", "Julia version/channel to run (overrides the spec)")
    .option("--json", "print the result as JSON")
    .action(
      async (specPath: string, opts: { out?: string; juliaVersion?: string; json?: boolean }) => {
        const spec = parseSpec(specPath);
        const channel = opts.juliaVersion ?? spec.backend.version;
        const outPath = resolve(opts.out ?? defaultOut(specPath));

        const bin = await juliaupBin(ctx);
        const resolved = await resolveVersion(bin, channel, ctx.run);

        const provisioned = existsSync(join(managedProjectDir(), "Project.toml"));
        if (!opts.json && !provisioned) {
          process.stdout.write(
            "Preparing the Julia environment (first run can take a few minutes)...\n",
          );
        }
        const projectDir = await ensureProject(resolved.command, createRunner(INSTALL_TIMEOUT_MS));

        if (!opts.json) process.stdout.write(`Fitting ${spec.backend.id} on Julia ${channel}...\n`);
        const result = await runFit(spec, resolved, {
          spawn: createFitRunner(),
          projectDir,
          outPath,
        });

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else if (result.status === "ok") {
          process.stdout.write(
            `${pc.green("ok")} ${result.samplesFile} (Julia ${result.runtimeActual ?? channel}, ${result.elapsedMs} ms)\n`,
          );
          process.stdout.write(pc.dim(`run record: ${outPath}.run.json\n`));
        } else {
          process.stdout.write(
            `${pc.red("fit failed")}${result.stage ? ` at ${result.stage}` : ""}: ${result.error}\n`,
          );
        }
        process.exitCode = result.status === "ok" ? 0 : 1;
      },
    );
}
