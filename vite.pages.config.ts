import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const stagePath = resolve(import.meta.dirname, ".event-data-stage.json");
const staged = existsSync(stagePath) ? JSON.parse(readFileSync(stagePath, "utf8")) as { eventId: string } : { eventId: "sample" };
const eventPath = resolve(import.meta.dirname, "public", "data", "events", staged.eventId, "event.json");
const fixturePath = resolve(import.meta.dirname, "fixtures", "events", "sample", "event.json");
const activeEvent = JSON.parse(readFileSync(existsSync(eventPath) ? eventPath : fixturePath, "utf8"));

export default defineConfig({
  plugins: [react()],
  define: { __ACTIVE_EVENT_DEFINITION__: JSON.stringify(activeEvent) },
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
