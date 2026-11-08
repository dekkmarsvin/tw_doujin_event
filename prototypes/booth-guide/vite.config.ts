import { resolve } from "node:path";
import { defineConfig } from "vite";
import pages from "../../vite.pages.config";

export default defineConfig({
  ...pages,
  build: {
    outDir: ".tmp/booth-guide-dist",
    rollupOptions: { input: resolve(import.meta.dirname, "index.html") },
  },
});
