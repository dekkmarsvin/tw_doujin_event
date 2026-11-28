import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

type StagedEvent = { eventId: string };
type Stage = { eventId: string; events?: readonly StagedEvent[] };

// Only the dev server and fixture builds stage events. A deploy build stages
// nothing: deployed pages get the published events from the server (#546), so
// no event is baked into the bundle.
const stagePath = resolve(import.meta.dirname, ".event-data-stage.json");
const staged: Stage | null = existsSync(stagePath)
  ? JSON.parse(readFileSync(stagePath, "utf8")) as Stage
  : null;
// The manifest carries the whole staged set; `eventId` alone is the pre-#119
// shape and still means "the one event", so it reads as a set of one.
const stagedEvents = staged ? staged.events ?? [{ eventId: staged.eventId }] : [];

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
  define: staged ? { __PUBLISHED_EVENTS__: JSON.stringify(publishedEvents) } : {},
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: chunk => chunk.name === "publicAccount" ? "public-account.js" : "assets/[name]-[hash].js",
      },
      input: {
        publicAccount: resolve(import.meta.dirname, "public-account-main.ts"),
        // The reader. Static, offline-capable, no identity.
        index: resolve(import.meta.dirname, "index.html"),
        // The circle control surface. Separate entry so the reader's bundle
        // never carries login, claim or edit code.
        circle: resolve(import.meta.dirname, "circle.html"),
        // The invitation-only organizer control surface. It shares the
        // session cookie with /circle, but not either entry's application
        // bundle or navigation.
        organizer: resolve(import.meta.dirname, "organizer.html"),
        // Existing moderation tools share the session; sign-in stays in /circle.
        admin: resolve(import.meta.dirname, "admin.html"),
        // A circle introduction page's own script: the circle's live content
        // and the planning actions. A template, not a page — the discovery
        // build copies its asset tags into the static pages and removes it.
        circlePage: resolve(import.meta.dirname, "circle-page.html"),
        // Event introductions and /portal/: only the interface language (#525).
        // Also a template; the discovery build copies its tags and removes it.
        publicPage: resolve(import.meta.dirname, "public-page.html"),
      },
    },
  },
});
