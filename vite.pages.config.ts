import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // The reader. Static, offline-capable, no identity.
        index: resolve(import.meta.dirname, "index.html"),
        // The circle control surface. Separate entry so the reader's bundle
        // never carries login, claim or edit code.
        circle: resolve(import.meta.dirname, "circle.html"),
      },
    },
  },
});
