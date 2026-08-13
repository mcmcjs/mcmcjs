#!/usr/bin/env node
// Writes docs/public/latest.txt with the CLI's current version, published with
// the docs site. The install script reads it to find the right release: the
// repo's "latest release" may be a library, which ships no binaries.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
const out = join(root, "docs", "public", "latest.txt");

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${version}\n`);
process.stdout.write(`latest.txt -> ${version}\n`);
