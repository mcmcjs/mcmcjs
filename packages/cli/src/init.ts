import { mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { seedSandbox, templatesDir } from "./sandbox";

/**
 * Seeds `dir` with the example files, refusing a non-empty directory unless
 * forced. Pure (takes the template source) so it is testable without the build.
 */
export function initSeed(dir: string, from: string, force: boolean): string[] {
  mkdirSync(dir, { recursive: true });
  if (!force && readdirSync(dir).length > 0) {
    throw new Error(`${dir} is not empty; pass --force to seed it anyway`);
  }
  return seedSandbox(dir, from);
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .summary("seed a directory with an example model")
    .helpGroup("Start a project:")
    .argument("[dir]", "directory to seed (default: current directory)", ".")
    .description("Seed a directory with a runnable example model and data (no shell, no prompts)")
    .option("--force", "seed even if the directory already has files")
    .option("--json", "print the result as JSON")
    .action((dir: string, opts: { force?: boolean; json?: boolean }) => {
      const target = resolve(dir);
      const files = initSeed(target, templatesDir(), Boolean(opts.force));
      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify({ action: "init", dir: target, files }, null, 2)}\n`,
        );
        return;
      }
      const modelPath = dir === "." ? "model.jl" : `${dir.replace(/\/$/, "")}/model.jl`;
      process.stdout.write(`seeded ${files.join(", ")} in ${target}\ntry: mcmc run ${modelPath}\n`);
    });
}
