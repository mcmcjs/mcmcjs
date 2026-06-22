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
  // The pinned, resolved env (Project + Manifest) ships the same way so a fresh
  // provision instantiates the exact committed package set.
  onSuccess: async () => {
    mkdirSync("dist", { recursive: true });
    for (const file of ["driver.jl", "worker.jl", "fitlib.jl"]) {
      copyFileSync(`src/driver/${file}`, `dist/${file}`);
    }
    mkdirSync("dist/julia-env", { recursive: true });
    for (const file of ["Project.toml", "Manifest.toml"]) {
      copyFileSync(`src/julia-env/${file}`, `dist/julia-env/${file}`);
    }
  },
});
