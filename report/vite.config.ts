import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The project site serves this under /mcmcjs/report/; the org site at the
  // root serves it under /report/. Set BASE_PATH to publish elsewhere.
  base: process.env.BASE_PATH ?? "/mcmcjs/report/",
  plugins: [react()],
  resolve: {
    alias: {
      fs: fileURLToPath(new URL("./src/shims/node-fs.ts", import.meta.url)),
      path: fileURLToPath(new URL("./src/shims/node-path.ts", import.meta.url)),
      crypto: fileURLToPath(new URL("./src/shims/node-crypto.ts", import.meta.url)),
    },
  },
});
