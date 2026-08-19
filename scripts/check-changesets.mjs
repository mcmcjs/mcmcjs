#!/usr/bin/env node
// Every package whose published sources changed needs a changeset naming it.
// Without one the package is not republished, so a sibling keeps depending on
// its last released version: that is how a CLI once shipped importing a symbol
// its installed dependency did not export yet. `changeset status` does not catch
// this, because it is satisfied by a changeset for any one package.
//
// Only `src/` and `package.json` count: tests, configs, and prose do not reach
// the published artifact, so changing them alone needs no release.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "origin/main";
const root = new URL("..", import.meta.url).pathname;

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Published package name per workspace directory, e.g. "packages/cli" -> "mcmcjs". */
function workspacePackages() {
  const dirs = [...readdirSync(join(root, "packages")).map((d) => join("packages", d)), "report"];
  const byDir = new Map();
  for (const dir of dirs) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
      if (pkg.name && !pkg.private) byDir.set(dir, pkg.name);
    } catch {
      // Not a package directory.
    }
  }
  return byDir;
}

/** Package names named by the frontmatter of every pending changeset. */
function releasedPackages() {
  const named = new Set();
  for (const file of readdirSync(join(root, ".changeset"))) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    const text = readFileSync(join(root, ".changeset", file), "utf8");
    const frontmatter = text.split("---")[1] ?? "";
    for (const [, name] of frontmatter.matchAll(/^"([^"]+)":/gm)) named.add(name);
  }
  return named;
}

const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
const byDir = workspacePackages();
const released = releasedPackages();

const missing = new Set();
for (const file of changed) {
  for (const [dir, name] of byDir) {
    const publishes = file.startsWith(`${dir}/src/`) || file === `${dir}/package.json`;
    if (publishes && !released.has(name)) missing.add(name);
  }
}

if (missing.size > 0) {
  const list = [...missing].sort();
  console.error(
    `These packages have published changes with no changeset naming them:\n${list
      .map((n) => `  ${n}`)
      .join(
        "\n",
      )}\n\nRun pnpm changeset (or changeset add --empty when a change truly needs no release).`,
  );
  process.exit(1);
}

console.log(`every changed package has a changeset (against ${base})`);
