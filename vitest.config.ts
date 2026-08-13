import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the doodleppl build's `.tpl` text loader so tests can import templates.
  plugins: [
    {
      name: "tpl-text",
      enforce: "pre",
      load(id: string) {
        if (id.endsWith(".tpl")) {
          return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
        }
        return null;
      },
    },
  ],
  // The CLI build stamps its version in; tests get a stand-in.
  define: { __MCMC_VERSION__: '"0.0.0-test"' },
  test: {
    include: ["packages/**/test/**/*.test.ts", "report/test/**/*.test.ts"],
    globalSetup: "./vitest.global-setup.ts",
    coverage: { provider: "v8", include: ["packages/*/src/**/*.ts"] },
  },
});
