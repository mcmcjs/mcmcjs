import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkill, skillDir } from "../src/skill";
import { SKILL_FILES } from "../src/skill.generated";

let dir: string;
const SKILLS = join(__dirname, "..", "skills");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcmcjs-skill-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("skillDir", () => {
  it("puts a project skill in the repo and a personal one at home", () => {
    expect(skillDir("project", "/p")).toBe(join("/p", ".claude", "skills"));
    expect(skillDir("user")).toBe(join(homedir(), ".claude", "skills"));
  });
});

describe("installSkill", () => {
  it("writes the skill where an assistant looks for it", () => {
    const written = installSkill(dir, false);
    expect(written).toEqual([join(dir, "mcmcjs", "SKILL.md")]);
    expect(readFileSync(written[0] as string, "utf8")).toContain("build_model(data)");
  });

  it("refuses to clobber an existing skill unless forced", () => {
    installSkill(dir, false);
    expect(() => installSkill(dir, false)).toThrow(/already exists; pass --force/);
    writeFileSync(join(dir, "mcmcjs", "SKILL.md"), "mine");
    installSkill(dir, true);
    expect(readFileSync(join(dir, "mcmcjs", "SKILL.md"), "utf8")).toContain("build_model");
  });
});

describe("the embedded skill", () => {
  it("matches packages/cli/skills on disk", () => {
    const onDisk: Record<string, string> = {};
    const walk = (base: string, prefix = ""): void => {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        const key = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(base, entry.name), key);
        else onDisk[key] = readFileSync(join(base, entry.name), "utf8");
      }
    };
    walk(SKILLS);
    expect(Object.keys(SKILL_FILES).sort()).toEqual(Object.keys(onDisk).sort());
    for (const [name, contents] of Object.entries(onDisk)) {
      expect(SKILL_FILES[name], `${name} is stale; run \`pnpm gen:skill\``).toBe(contents);
    }
  });

  // An assistant only loads a skill whose frontmatter says when it applies.
  it("carries frontmatter with a name and a description saying when to use it", () => {
    const text = SKILL_FILES["mcmcjs/SKILL.md"] as string;
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    expect(front).toMatch(/^name: mcmcjs$/m);
    expect(front).toMatch(/^description: .{40,}/m);
    expect(front).toMatch(/[Uu]se when/);
  });

  it("teaches the contract a model file has to meet", () => {
    const text = SKILL_FILES["mcmcjs/SKILL.md"] as string;
    expect(text).toContain("build_model(data)");
    expect(text).toMatch(/top level/);
    expect(text).toMatch(/exits `0`|exit 2|Exit 2/);
    expect(text).toContain("mcmc sbc");
  });
});

describe("the skills directory", () => {
  it("holds one skill, laid out as <name>/SKILL.md", () => {
    expect(readdirSync(SKILLS)).toEqual(["mcmcjs"]);
    expect(readdirSync(join(SKILLS, "mcmcjs"))).toContain("SKILL.md");
    // Keys are written with forward slashes so the embedded map is the same
    // whichever platform generated it.
    expect(Object.keys(SKILL_FILES).every((key) => !key.includes("\\"))).toBe(true);
  });
});
