import { cpSync, readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
  description: string;
  author: { name: string; url?: string };
  license: string;
  homepage: string;
};

// Branding shown by `mcmc --version`, baked in at build time so the dist needs
// no runtime package.json. The year is stamped at build, GNU-style.
const meta = {
  description: pkg.description,
  authorName: pkg.author.name,
  authorUrl: pkg.author.url,
  license: pkg.license,
  homepage: pkg.homepage.replace(/#.*$/, ""),
  year: new Date().getFullYear(),
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  define: {
    __MCMC_VERSION__: JSON.stringify(pkg.version),
    __MCMC_META__: JSON.stringify(meta),
  },
  // The sandbox example files ship inside dist/ (the files allowlist).
  onSuccess: async () => {
    cpSync("templates", "dist/templates", { recursive: true });
  },
});
