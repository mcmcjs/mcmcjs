import { writeFileSync } from "node:fs";
import { defineConfig } from "tsup";
import { graphJsonSchema } from "./src/core/schema";

export default defineConfig({
  entry: ["src/index.ts", "src/core/index.ts", "src/codegen/stan.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
  // Inline `.tpl` templates as strings so the build stays self-contained (browser-safe).
  esbuildOptions: (options) => {
    options.loader = { ...options.loader, ".tpl": "text" };
  },
  // The graph format's JSON Schema ships as a plain artifact so non-TypeScript
  // consumers (and agents) can validate graphs without importing the package.
  onSuccess: async () => {
    writeFileSync("dist/graph.schema.json", `${JSON.stringify(graphJsonSchema(), null, 2)}\n`);
  },
});
