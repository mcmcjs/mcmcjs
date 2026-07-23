import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/mcmcjs/report/",
  plugins: [react()],
  resolve: {
    alias: {
      fs: fileURLToPath(new URL("./src/shims/node-fs.ts", import.meta.url)),
      path: fileURLToPath(new URL("./src/shims/node-path.ts", import.meta.url)),
      crypto: fileURLToPath(new URL("./src/shims/node-crypto.ts", import.meta.url)),
    },
  },
});
