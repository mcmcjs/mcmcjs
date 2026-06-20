import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

/**
 * The exit prompt. Returns "keep"/"delete", or "abort" for a panic key (Ctrl+C)
 * or EOF (Ctrl+D) — which must never trigger the destructive default. Without
 * the SIGINT/close handling, Ctrl+C would kill the process before either branch
 * ran, orphaning the sandbox with no message.
 */
function askKeep(): Promise<"keep" | "delete" | "abort"> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: "keep" | "delete" | "abort") => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(result);
    };
    rl.question("\nKeep this sandbox? Press Enter or n to delete, or y to keep: ", (answer) =>
      done(/^y(es)?$/i.test(answer.trim()) ? "keep" : "delete"),
    );
    rl.on("SIGINT", () => done("abort"));
    rl.on("close", () => done("abort")); // EOF / Ctrl+D with no answer
  });
}

export interface SandboxKeepOpts {
  keep?: boolean;
  delete?: boolean;
  keepDir?: string;
  name?: string;
}

export type KeepPlan = { mode: "delete" } | { mode: "keep"; target?: string } | { mode: "prompt" };

/** Validates a kept-sandbox name as a single safe path segment. */
export function safeSegment(name: string): string {
  const n = name.trim();
  if (n === "" || n === "." || n === ".." || !/^[A-Za-z0-9._-]+$/.test(n)) {
    throw new Error(`--name must be a single path segment (letters, digits, . _ -); got "${name}"`);
  }
  return n;
}

/** The kept-sandbox destination from flags; undefined means keep it in place. */
function keepTarget(opts: SandboxKeepOpts, launchCwd: string): string | undefined {
  const name = opts.name !== undefined ? safeSegment(opts.name) : undefined;
  if (opts.keepDir !== undefined) {
    const base = resolve(launchCwd, opts.keepDir);
    return name ? join(base, name) : base;
  }
  if (name) return join(launchCwd, name);
  return undefined; // --keep alone: leave it where it is
}

/**
 * Resolves the exit disposition from flags. With no disposition flag the user
 * is prompted; flags decide up front so the command is scriptable.
 */
export function resolveKeep(opts: SandboxKeepOpts, launchCwd: string): KeepPlan {
  const wantsKeep = Boolean(opts.keep || opts.keepDir !== undefined || opts.name !== undefined);
  if (opts.delete && wantsKeep) {
    throw new Error("use either --delete or --keep/--keep-dir/--name, not both");
  }
  if (opts.delete) return { mode: "delete" };
  if (!wantsKeep) return { mode: "prompt" };
  return { mode: "keep", target: keepTarget(opts, launchCwd) };
}

/** A free path: appends -2, -3, ... when the target already exists. */
export function uniqueTarget(path: string): string {
  if (!existsSync(path)) return path;
  for (let n = 2; ; n += 1) {
    const candidate = `${path}-${n}`;
    if (!existsSync(candidate)) return candidate;
  }
}

/**
 * Moves a kept sandbox out of the temp dir. Copies first, then removes the
 * source, so a cross-filesystem move (the temp dir is often a separate mount,
 * where rename fails EXDEV) still works and a failed copy never loses the source.
 */
export function relocate(src: string, target: string): string {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(src, target, { recursive: true });
  rmSync(src, { recursive: true, force: true });
  return target;
}

interface SandboxOpts extends SandboxKeepOpts {
  strict?: boolean;
}

export function registerSandbox(program: Command): void {
  program
    .command("sandbox")
    .summary("throwaway shell with an example model")
    .helpGroup("Start a project:")
    .description("Open a throwaway shell seeded with a working example model")
    .option(
      "--strict",
      "isolate Julia entirely: a fresh environment with no Julia installed, all of it inside the sandbox",
    )
    .option("--keep", "keep the sandbox on exit instead of prompting")
    .option("--delete", "delete the sandbox on exit without prompting")
    .option("--keep-dir <path>", "keep the sandbox, saved to this path (implies --keep)")
    .option("--name <name>", "name for the kept sandbox directory (implies --keep)")
    .addHelpText(
      "after",
      "\nLeaving the shell (exit or Ctrl+D) prompts to keep or delete; press Enter to delete." +
        "\nPre-decide without the prompt: --keep, --delete, or --keep-dir <path> [--name <n>]." +
        "\n--strict starts with no Julia installed; run `mcmc setup` inside to provision it." +
        "\nFor scripts and agents, `mcmc init <dir>` seeds the same files without a shell.",
    )
    .action(async (opts: SandboxOpts) => {
      const launchCwd = process.cwd();
      const plan = resolveKeep(opts, launchCwd); // validates flag conflicts up front
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error(
          "mcmc sandbox opens an interactive shell, so it needs a terminal.\n" +
            "For scripts or AI agents, run `mcmc init <dir>` to seed the example files, then the\n" +
            "non-interactive commands, e.g. `mcmc run model.jl --json`.",
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
          `  try:    ${pc.bold("mcmc run model.jl")}  ${pc.dim("(picks up data.csv automatically)")}`,
          "  leaving the shell deletes the sandbox (you will be asked first)",
          "",
        ].join("\n"),
      );

      const code = await runShell(dir, extraEnv);

      let decision = plan.mode;
      if (decision === "prompt") {
        const answer = await askKeep();
        if (answer === "abort") {
          // A panic key must not destroy the sandbox; leave it and say where.
          process.stderr.write(
            `\naborted; sandbox left at ${dir}\n  delete it with: rm -rf ${dir}\n`,
          );
          process.exitCode = code;
          return;
        }
        decision = answer;
      }

      if (decision === "delete") {
        rmSync(dir, { recursive: true, force: true });
        process.stdout.write("sandbox deleted\n");
      } else if (plan.mode === "keep" && plan.target) {
        if (opts.strict) {
          process.stderr.write(
            pc.yellow(
              "note: a strict sandbox carries a full Julia depot under env/; this copies it and the\n" +
                "      Julia install is pinned to the old path, so it will not run from the new location\n",
            ),
          );
        }
        const saved = relocate(dir, uniqueTarget(plan.target));
        process.stdout.write(`saved to ${saved}\n`);
      } else {
        process.stdout.write(`kept at ${dir}\n`);
      }
      process.exitCode = code;
    });
}
