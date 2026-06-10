import { writeFileSync } from "node:fs";
import { defineConfig } from "tsup";
import { graphJsonSchema } from "./src/schema";

export default defineConfig({
  entry: ["src/index.ts", "src/stan.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
  // The graph format's JSON Schema ships as a plain artifact so non-TypeScript
  // consumers (and agents) can validate graphs without importing the package.
  onSuccess: async () => {
    writeFileSync("dist/graph.schema.json", `${JSON.stringify(graphJsonSchema(), null, 2)}\n`);
  },
});
