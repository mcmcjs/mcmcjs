import { defineConfig } from "tsup";

// Two builds: the library entries stay external-friendly for consumer bundlers,
// while the worker bundles tinystan into one self-contained module file so it can
// be loaded by URL inside a Web Worker.
export default defineConfig([
  {
    entry: { index: "src/index.ts", "react/index": "src/react/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    platform: "neutral",
    external: ["tinystan", "react"],
    outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
  },
  {
    entry: { worker: "src/worker.ts" },
    format: ["esm"],
    sourcemap: true,
    platform: "browser",
    noExternal: [/.*/],
  },
]);
