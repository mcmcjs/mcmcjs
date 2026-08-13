#!/usr/bin/env node
// Builds the single-file `mcmc` binary with Bun, for people who install
// without npm. Usage:
//   node scripts/build-binary.mjs [--target bun-linux-x64] [--outdir dist-bin]
// With no --target, builds for the host. The binary embeds the Bun runtime, so
// it needs no Node.js installed; Julia or CmdStan are still provisioned by
// `mcmc setup` as usual.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));

/** Platforms we publish, keyed by the asset name the installer asks for. */
export const TARGETS = {
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
  "darwin-x64": "bun-darwin-x64",
  "darwin-arm64": "bun-darwin-arm64",
  "windows-x64": "bun-windows-x64",
};

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const asset = flag("--target");
const outdir = resolve(root, flag("--outdir") ?? "dist-bin");
const bunTarget = asset ? TARGETS[asset] : undefined;
if (asset && !bunTarget) {
  process.stderr.write(
    `unknown --target ${asset}; expected one of: ${Object.keys(TARGETS).join(", ")}\n`,
  );
  process.exit(2);
}

const meta = {
  description: pkg.description,
  authorName: pkg.author.name,
  authorUrl: pkg.author.url,
  license: pkg.license,
  homepage: pkg.homepage.replace(/#.*$/, ""),
  year: new Date().getFullYear(),
};

mkdirSync(outdir, { recursive: true });
const name = asset?.startsWith("windows") ? "mcmc.exe" : "mcmc";
const outfile = join(
  outdir,
  asset ? `mcmc-${asset}${asset.startsWith("windows") ? ".exe" : ""}` : name,
);

// Defines are replaced as source text, so each value has to be a JS expression.
const bunArgs = [
  "build",
  join(root, "packages/cli/src/index.ts"),
  "--compile",
  "--minify",
  "--define",
  `__MCMC_VERSION__=${JSON.stringify(pkg.version)}`,
  "--define",
  `__MCMC_META__=${JSON.stringify(meta)}`,
  "--define",
  "__MCMC_COMPILED__=true",
  "--outfile",
  outfile,
  ...(bunTarget ? ["--target", bunTarget] : []),
];

const result = spawnSync("bun", bunArgs, { stdio: "inherit", cwd: root });
if (result.error) {
  process.stderr.write(`bun is required to build the binary: https://bun.sh\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
