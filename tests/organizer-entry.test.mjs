import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("organizer authoring ships as an unlinked, noindex Pages entry", async () => {
  const [config, html, reader, organizerMain] = await Promise.all([
    readFile(new URL("../vite.pages.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../organizer.html", import.meta.url), "utf8"),
    readFile(new URL("../app/event-map-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../organizer-main.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(config, /organizer:\s*resolve\([^\n]+"organizer\.html"\)/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(html, /src="\/organizer-main\.tsx"/);
  assert.doesNotMatch(reader, /href=["']\/organizer|前往主辦單位後台/);
  assert.match(organizerMain, /OrganizerApp/);
});

test("organizer login uses its audience and narrow screens never mount authoring controls", async () => {
  const [app, client] = await Promise.all([
    readFile(new URL("../app/organizer/organizer-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/organizer-client.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /requestLoginLink\([^\n]+"organizer"\)/);
  assert.match(app, /請改用桌機/);
  assert.match(app, /matchMedia\("\(min-width: 1040px\)"\)/);
  assert.match(app, /isDesktop\s*\?\s*<OrganizerWorkspace/);
  assert.match(client, /\/api\/organizer\/events/);
});
