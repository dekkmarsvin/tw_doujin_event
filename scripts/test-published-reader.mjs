// A publication-data PR exercises its actual complete production build. This
// deliberately does not enter tests/browser's fixture/FF47 journey discovery.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { parsePublishedEvents } from "../app/published-events.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = async relative => JSON.parse(await readFile(new URL(`../${relative}`, import.meta.url), "utf8"));
const events = parsePublishedEvents(await read("data/published-events.json"));
const stage = await read(".event-data-stage.json");
assert.deepEqual(stage.events, events.map(eventId => ({ eventId, source: "pin" })), "browser must exercise current published pins, never fixtures");
const server = await preview({ root, configFile: false, preview: { host: "127.0.0.1", port: 0, open: false } });
process.env.MAP_TEST_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
const { start, base } = await import("../tests/browser/support/journey.mjs");
const journey = await start("published-reader");
journey.report.source = "local production build from all published pins; Functions evidence belongs to the separate preview E2E gate";
journey.report.matrixMode = "published-desktop-mobile";
journey.report.events = events;
try {
  const chooser = await journey.page({ url: base });
  for (const eventId of events) {
    const event = await read(`dist/data/events/${eventId}/event.json`);
    const catalog = await read(`dist/data/events/${eventId}/circles.json`);
    await chooser.getByRole("link", { name: `開啟攤位地圖：${event.name}`, exact: true }).waitFor();
    for (const [size, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
      for (const day of event.days) for (const space of event.venueAssignments) {
        const params = new URLSearchParams({ event: eventId, day: String(day.id), venueSpaceId: space.venueSpaceId });
        const placement = catalog.placements.find(item => String(item.day) === String(day.id) && space.areaIds.includes(item.area) && item.status === "active");
        if (placement) params.set("selectedBooth", placement.boothCode);
        const page = await journey.page({ url: `${base}/?${params}`, viewport });
        await page.locator("[data-slot-code]").first().waitFor();
        assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), `https://map.kotoban.top/events/${eventId}/${placement ? `circles/${placement.circleId}/` : ""}`);
        if (placement) {
          const circle = catalog.circles.find(item => item.id === placement.circleId);
          const selected = page.getByRole(size === "mobile" ? "region" : "complementary", { name: size === "mobile" ? "已選社團摘要" : "已選社團詳情", exact: true });
          await selected.getByText(circle.name, { exact: true }).first().waitFor();
        }
        await journey.capture(page, `published-${eventId}-${day.id}-${space.venueSpaceId}-${size}`);
        // The same context retains its Service Worker/cache on a normal reload.
        await page.reload();
        await page.locator("[data-slot-code]").first().waitFor();
        assert.equal(new URL(page.url()).searchParams.get("event"), eventId);
        await page.close();
      }
    }
  }
  await chooser.close();
  await journey.finish();
} catch (error) {
  await journey.abort(error);
} finally {
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
