// Shared plumbing for the fixture-backed reader journeys.
//
// These journeys run against `fixtures/events/`, not the pinned event: the
// scenarios they need — a moved booth, a cancelled booth, a circle with and
// without a picture — do not exist in real FF47 data and must not be invented
// inside it. The fixtures are small enough to restate a whole catalog, so each
// scenario is served by intercepting the two documents the reader reads rather
// than by editing anything on disk. That also keeps these journeys offline:
// only the pinned viewport journey needs the network.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const chromium = playwright.chromium ?? playwright.default?.chromium;

export const base = (process.env.MAP_TEST_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
export const output = path.resolve(process.env.MAP_TEST_OUTPUT || "outputs/map-viewport-pr");

/** A 1x1 PNG, so "the picture loaded" is provable without shipping an asset. */
export const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
// Overrides only accept https, so a picture cannot be served from the local
// dev server; the journeys answer this origin themselves instead.
export const PICTURE = "https://pictures.test/circle.png";

export async function start(name) {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const report = { journey: name, browser: browser.version(), recordedAt: new Date().toISOString(), source: "local fixtures, not production", checks: [], errors: [] };

  return {
    report,
    async page({ event = "sample", params = "", viewport = { width: 1440, height: 900 }, routes } = {}) {
      const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) => report.errors.push(error.message));
      if (routes) await routes(page);
      await page.goto(`${base}/?event=${encodeURIComponent(event)}${params}`);
      return page;
    },
    /** Wait for the map itself, so a journey never asserts against a half-built page. */
    async mapPage(options = {}) {
      const page = await this.page(options);
      await page.locator("[data-slot-code]").first().waitFor();
      await page.waitForTimeout(250);
      return page;
    },
    async capture(page, name) {
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      // Every journey owns this one: a reader who has to scroll sideways to
      // finish a sentence has a broken page whatever else passed.
      const overflow = await page.evaluate(() => document.body.scrollWidth - innerWidth);
      if (overflow > 0) throw new Error(`${name}: horizontal page overflow of ${overflow}px`);
      report.checks.push(name);
    },
    async finish() {
      await writeFile(path.join(output, `browser-report-${name}.json`), JSON.stringify(report, null, 2));
      await browser.close();
      if (report.errors.length) throw new Error(`page errors: ${report.errors.join("; ")}`);
      console.log(`Passed ${report.checks.length} checks — ${name}.`);
    },
    async abort(error) {
      await writeFile(path.join(output, `browser-report-${name}.json`), JSON.stringify({ ...report, failure: String(error) }, null, 2)).catch(() => {});
      await browser.close();
      throw error;
    },
  };
}

/** Replace the catalog the reader reads, built from the real fixture it ships. */
export function catalogRoute(eventId, mutate) {
  return async (page) => {
    await page.route(`**/data/events/${eventId}/circles.json`, async (route) => {
      const source = await (await fetch(`${base}/data/events/${eventId}/circles.json`)).json();
      mutate(source);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(source) });
    });
  };
}

/** Serve circle-authored content; `overrides` of `[]` is "nobody filled anything in". */
export function overridesRoute(eventId, overrides) {
  return async (page) => {
    await page.route(`**/data/events/${eventId}/overrides.json`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schema: "circle-overrides/1", eventId, generatedAt: "2026-01-01T00:00:00.000+08:00", revision: 1, overrides }),
    }));
  };
}

/** `loads` false is a picture whose URL survived but whose bytes did not. */
export function pictureRoute(loads) {
  return async (page) => {
    await page.route(PICTURE, (route) => (loads
      ? route.fulfill({ status: 200, contentType: "image/png", body: PIXEL })
      : route.fulfill({ status: 404, contentType: "text/plain", body: "gone" })));
  };
}

export const thumbnailOverride = (circleId) => ([{
  circleId,
  updatedAt: "2026-01-01T00:00:00.000+08:00",
  fields: { thumbnail: { url: PICTURE, sourceUrl: "", provider: "circle" } },
}]);

/** Apply several route setups to one page. */
export const routes = (...setups) => async (page) => { for (const setup of setups) await setup(page); };
