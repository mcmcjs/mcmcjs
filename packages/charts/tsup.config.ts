import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/dom/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["uplot"],
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
});
