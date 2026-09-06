// Bundle the parser, layout, renderer and codegen for the browser viewer.
//
//   node build-bundle.mjs        -> dist/graph.js (ESM, self-contained)
//
// esbuild is a dependency of tsup rather than of the workspace root, so it is
// resolved through pnpm's virtual store.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
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

// The page loads the widget built from this tree, not the released package,
// so the two fixes it depends on (layout on open, validation by language) are
// present. Build it first: pnpm --filter @mcmcjs/doodleppl build && pnpm --filter doodleppl build
const widget = join(root, "packages/doodleppl-ui/dist/doodleppl.global.js");
if (existsSync(widget)) {
  mkdirSync(join(here, "vendor"), { recursive: true });
  copyFileSync(widget, join(here, "vendor/doodleppl.global.js"));
  console.log("copied the widget bundle to vendor/doodleppl.global.js");
} else {
  console.warn(
    "widget bundle not found; build doodleppl-ui first so vendor/doodleppl.global.js exists",
  );
}
