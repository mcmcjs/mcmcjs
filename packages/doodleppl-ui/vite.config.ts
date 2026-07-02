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
    plugins: [
      // Only the canvas subtree renders inside the shadow root; compiling just those
      // SFCs in custom-element mode attaches their styles to the component so
      // defineCustomElement injects them there. Everything else teleports to the page
      // body and keeps its styles head-injected by cssInjectedByJsPlugin.
      vue({ features: { customElement: /(DoodleWidget|GraphEditor|GraphCanvas)\.vue$/ } }),
      cssInjectedByJsPlugin({
        relativeCSSInjection: !cdn,
        // Stringified into each chunk, so it must stay self-contained: it appends the
        // CSS to document.head (the default behavior) and also records it so widget
        // instances can replay it into their overlay shadow roots (see
        // src/widget/utils/shadowStyles.ts).
        injectCodeFunction: function doodlepplInjectCss(cssCode) {
          try {
            if (typeof document !== "undefined") {
              const style = document.createElement("style");
              style.appendChild(document.createTextNode(cssCode));
              document.head.appendChild(style);
              const g = globalThis as { __DOODLEPPL_CSS__?: string[] };
              g.__DOODLEPPL_CSS__ = g.__DOODLEPPL_CSS__ || [];
              g.__DOODLEPPL_CSS__.push(cssCode);
              document.dispatchEvent(new CustomEvent("doodleppl:css"));
            }
          } catch (e) {
            console.error("doodleppl css injection", e);
          }
        },
      }),
    ],
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
