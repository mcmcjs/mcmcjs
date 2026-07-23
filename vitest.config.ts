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
  test: {
    include: ["packages/**/test/**/*.test.ts", "report/test/**/*.test.ts"],
    globalSetup: "./vitest.global-setup.ts",
    coverage: { provider: "v8", include: ["packages/*/src/**/*.ts"] },
  },
});
