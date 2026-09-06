// Bundle the parser, layout, renderer and codegen for the browser viewer.
//
//   node build-bundle.mjs        -> dist/graph.js (ESM, self-contained)
//
// esbuild is a dependency of tsup rather than of the workspace root, so it is
// resolved through pnpm's virtual store.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const require = createRequire(join(root, "node_modules/.pnpm/node_modules/"));
const { build } = require("esbuild");

const entry = `
export { parseBugs, BugsSyntaxError } from "${join(root, "packages/doodleppl/src/parse/index.ts")}";
export { graphFromStanAst } from "${join(root, "packages/doodleppl/src/parse/stan.ts")}";
export { layoutGraph, applyLayout, renderGraphSvg } from "${join(root, "packages/doodleppl/src/render/index.ts")}";
export { generateBugsModel } from "${join(root, "packages/doodleppl/src/codegen/bugs.ts")}";
export { generateStanModel } from "${join(root, "packages/doodleppl/src/codegen/stan.ts")}";
`;

await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: join(here, "dist/graph.js"),
  loader: { ".tpl": "text" },
  logLevel: "info",
});
