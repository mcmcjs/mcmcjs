import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { SKILL_FILES } from "./skill.generated";

/**
 * Where an agent looks for skills: a project directory shares one with everyone
 * who clones the repo, the home directory keeps it for you alone.
 */
export function skillDir(scope: "user" | "project", cwd = process.cwd()): string {
  return scope === "project"
    ? join(cwd, ".claude", "skills")
    : join(homedir(), ".claude", "skills");
}

/** Writes the embedded skill files under `dir`; returns the paths written. */
export function installSkill(dir: string, force: boolean): string[] {
  const written: string[] = [];
  for (const [name, contents] of Object.entries(SKILL_FILES)) {
    const path = join(dir, name);
    if (existsSync(path) && !force) {
      throw new Error(`${path} already exists; pass --force to overwrite`);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    written.push(path);
  }
  return written;
}

export function registerSkill(program: Command): void {
  const skill = program
    .command("skill")
    .summary("install the agent skill for mcmcjs")
    .helpGroup("Toolchain:")
    .description(
      "Install the skill that teaches an AI assistant how to write models for mcmcjs and read its diagnostics.",
    );

  skill
    .command("install", { isDefault: true })
    .description("write the skill where an assistant will find it")
    .option("--project", "install into ./.claude/skills (shared with the repo)")
    .option("--force", "overwrite an existing copy")
    .option("--json", "print the result as JSON")
    .action((opts: { project?: boolean; force?: boolean; json?: boolean }) => {
      const dir = skillDir(opts.project ? "project" : "user");
      const written = installSkill(dir, Boolean(opts.force));
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ action: "skill install", written }, null, 2)}\n`);
        return;
      }
      for (const path of written) process.stdout.write(`${pc.green("wrote")} ${path}\n`);
      process.stdout.write(
        `\n${pc.dim("Pair it with the tools:")} claude mcp add mcmcjs -- mcmc mcp\n`,
      );
    });

  skill
    .command("show")
    .description("print the skill instead of installing it")
    .action(() => {
      for (const contents of Object.values(SKILL_FILES)) process.stdout.write(contents);
    });
}
