import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts"],
    globalSetup: "./vitest.global-setup.ts",
    coverage: { provider: "v8", include: ["packages/*/src/**/*.ts"] },
  },
});
