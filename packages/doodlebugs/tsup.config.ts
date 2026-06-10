import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/stan.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
});
