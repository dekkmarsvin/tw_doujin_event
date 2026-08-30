import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

type StagedEvent = { eventId: string };
type Stage = { eventId: string; events?: readonly StagedEvent[] };

const stagePath = resolve(import.meta.dirname, ".event-data-stage.json");
const staged: Stage = existsSync(stagePath)
  ? JSON.parse(readFileSync(stagePath, "utf8")) as Stage
  : { eventId: "sample" };
// The manifest carries the whole staged set; `eventId` alone is the pre-#119
// shape and still means "the one event", so it reads as a set of one.
const stagedEvents = staged.events ?? [{ eventId: staged.eventId }];

const fixture = (eventId: string, file: string) => resolve(import.meta.dirname, "fixtures", "events", eventId, file);
const stagedFile = (eventId: string, file: string) => resolve(import.meta.dirname, "public", "data", "events", eventId, file);
const readEventFile = (eventId: string, file: string) => {
  const staged = stagedFile(eventId, file);
  const path = existsSync(staged) ? staged : fixture(existsSync(fixture(eventId, file)) ? eventId : "sample", file);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
};

// The order here is the order the reader offers the events in, and the first is
// the default when a URL names no event.
const publishedEvents = stagedEvents.map(({ eventId }) => ({
  definition: readEventFile(eventId, "event.json"),
  references: readEventFile(eventId, "reference-records.json"),
}));

export default defineConfig({
  plugins: [react()],
  define: {
    __PUBLISHED_EVENTS__: JSON.stringify(publishedEvents),
  },
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
