import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

// Two builds from one source. The default (npm) build emits ES modules with the
// editor split into a lazily loaded chunk; `--mode cdn` emits one self-contained
// IIFE file for script-tag consumers. Styles (including fonts) are inlined and
// injected by the chunk that owns them, so consumers never import CSS. Type
// declarations are emitted separately by `vue-tsc -p tsconfig.dts.json`.
export default defineConfig(({ mode }) => {
  const cdn = mode === "cdn";
  return {
    plugins: [vue(), cssInjectedByJsPlugin({ relativeCSSInjection: !cdn })],
    // The npm build keeps process.env.NODE_ENV for consumer bundlers to define
    // (the same convention as Vue's esm-bundler builds); a script tag has no
    // bundler, so the IIFE must bake it in.
    define: cdn ? { "process.env.NODE_ENV": JSON.stringify("production") } : undefined,
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
            entry: { index: "src/index.ts", element: "src/element.ts" },
            formats: ["es"] as const,
            fileName: (_format, entryName) => `${entryName}.js`,
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
