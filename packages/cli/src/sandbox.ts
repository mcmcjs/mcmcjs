import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { sharedTmpParent } from "@mcmcjs/julia";
import type { Command } from "commander";
import pc from "picocolors";

/** The shipped example files, copied to dist/templates at build time. */
export function templatesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "templates");
}

/** Seeds a sandbox dir with the example files; returns their names, sorted. */
export function seedSandbox(dir: string, from = templatesDir()): string[] {
  const names = readdirSync(from).sort();
  for (const name of names) cpSync(join(from, name), join(dir, name));
  return names;
}

function makeSandboxDir(): string {
  const parent = sharedTmpParent();
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, "sandbox-"));
}

/**
 * Env that redirects every mcmcjs/Julia state path into the sandbox, so a
 * --strict session starts with no Julia installed: the managed env, Julia and
 * juliaup depots, caches, and worker sockets all live in (and die with) the
 * sandbox. `mcmc setup` inside installs a fresh toolchain there.
 */
export function strictEnv(dir: string): Record<string, string> {
  const root = join(dir, "env");
  const sub = (name: string, mode?: number) => {
    const p = join(root, name);
    mkdirSync(p, { recursive: true, ...(mode ? { mode } : {}) });
    return p;
  };
  const home = sub("home");
  return {
    // HOME so the juliaup installer writes into the sandbox's ~/.juliaup and
    // detection (which honors $HOME) finds it there rather than the real one.
    HOME: home,
    PATH: `${join(home, ".juliaup", "bin")}:${process.env.PATH ?? ""}`,
    XDG_DATA_HOME: sub("data"),
    XDG_CACHE_HOME: sub("cache"),
    XDG_RUNTIME_DIR: sub("run", 0o700),
    JULIA_DEPOT_PATH: sub("julia-depot"),
    JULIAUP_DEPOT_PATH: sub("juliaup"),
  };
}

function runShell(dir: string, extraEnv: Record<string, string> = {}): Promise<number> {
  const shell =
    process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : (process.env.SHELL ?? "sh");
  return new Promise((resolve) => {
    const child = spawn(shell, [], {
      cwd: dir,
      stdio: "inherit",
      env: { ...process.env, MCMC_SANDBOX: dir, ...extraEnv },
    });
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(1));
  });
}

function askKeep(dir: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(
      `\nThis sandbox and everything in it will be deleted.\nKeep ${dir}? [y/N] `,
      (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      },
    );
  });
}

export function registerSandbox(program: Command): void {
  program
    .command("sandbox")
    .description("Open a throwaway shell seeded with a working example model")
    .option(
      "--strict",
      "isolate Julia entirely: a fresh environment with no Julia installed, all of it inside the sandbox",
    )
    .addHelpText(
      "after",
      "\nLeaving the shell (exit or Ctrl+D) deletes the sandbox after a confirmation;" +
        "\nanswer y at the prompt to keep the directory instead." +
        "\n--strict starts with no Julia installed; run `mcmc setup` inside to provision it.",
    )
    .action(async (opts: { strict?: boolean }) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error(
          "mcmc sandbox needs an interactive terminal (it opens a shell and prompts on exit)",
        );
      }
      const dir = makeSandboxDir();
      const files = seedSandbox(dir);
      const extraEnv = opts.strict ? strictEnv(dir) : {};
      process.stdout.write(
        [
          "",
          `  mcmcjs sandbox at ${pc.bold(dir)}`,
          `  seeded: ${files.join(", ")}`,
          ...(opts.strict
            ? [
                `  ${pc.yellow("strict:")} no Julia here yet, run ${pc.bold("mcmc setup")} first (installs into the sandbox)`,
              ]
            : []),
          `  try:    ${pc.bold("mcmc run model.jl --data data.csv")}`,
          "  leaving the shell deletes the sandbox (you will be asked first)",
          "",
        ].join("\n"),
      );

      const code = await runShell(dir, extraEnv);

      if (await askKeep(dir)) {
        process.stdout.write(`kept ${dir}\n`);
      } else {
        rmSync(dir, { recursive: true, force: true });
        process.stdout.write("sandbox deleted\n");
      }
      process.exitCode = code;
    });
}
