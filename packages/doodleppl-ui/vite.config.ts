import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import dts from "vite-plugin-dts";

// Two builds from one source. The default (npm) build emits ES modules with the
// editor split into a lazily loaded chunk; `--mode cdn` emits one self-contained
// IIFE file for script-tag consumers. Styles (including fonts) are inlined and
// injected by the chunk that owns them, so consumers never import CSS.
export default defineConfig(({ mode }) => {
  const cdn = mode === "cdn";
  return {
    plugins: [
      vue(),
      cssInjectedByJsPlugin({ relativeCSSInjection: !cdn }),
      ...(cdn
        ? []
        : [dts({ include: ["src/index.ts", "src/tag.ts"], entryRoot: "src", rollupTypes: false })]),
    ],
    build: {
      outDir: "dist",
      emptyOutDir: !cdn,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: !cdn,
      lib: cdn
        ? {
            entry: "src/cdn.ts",
            formats: ["iife"] as const,
            name: "__doodleppl",
            fileName: () => "doodleppl.global.js",
          }
        : {
            entry: "src/index.ts",
            formats: ["es"] as const,
            fileName: () => "index.js",
          },
      rollupOptions: cdn
        ? {}
        : {
            external: ["@mcmcjs/doodleppl"],
            output: { chunkFileNames: "chunks/[name]-[hash].js" },
          },
    },
  };
});
