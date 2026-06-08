import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Shim import.meta.url in the CJS build so driverPath() resolves there too.
  shims: true,
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
  // The Julia driver ships as-is; copy it next to the bundle so the published
  // dist/ (the files allowlist) carries it and runFit can resolve it at runtime.
  onSuccess: async () => {
    mkdirSync("dist", { recursive: true });
    copyFileSync("src/driver/driver.jl", "dist/driver.jl");
  },
});
