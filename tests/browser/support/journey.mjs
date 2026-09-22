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
  const observations = new WeakMap();
  let aborted = false;

  return {
    report,
    /** `url` opens an exact address — a one-time login link; otherwise an event. */
    async page({ event = "sample", params = "", url, viewport = { width: 1440, height: 900 }, routes } = {}) {
      const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
      const requests = [];
      observations.set(page, requests);
      // Paths and status only: authentication URLs may contain a one-time
      // token, so never persist query strings, headers or request bodies.
      const remember = record => { requests.push(record); if (requests.length > 20) requests.shift(); };
      page.on("response", response => {
        remember({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() });
      });
      page.on("requestfailed", request => remember({ method: request.method(), path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) => report.errors.push(error.message));
      if (routes) await routes(page);
      await page.goto(url ?? `${base}/?event=${encodeURIComponent(event)}${params}`);
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
      if (report.errors.length) return this.abort(new Error(`page errors: ${report.errors.join("; ")}`));
      await writeFile(path.join(output, `browser-report-${name}.json`), JSON.stringify(report, null, 2));
      await browser.close();
      console.log(`Passed ${report.checks.length} checks — ${name}.`);
    },
    async abort(error) {
      // finish() may already have captured a pageerror before the journey's
      // outer catch calls abort again. Keep that first, still-open-page evidence.
      if (aborted) throw error;
      aborted = true;
      const diagnostics = [];
      for (const page of browser.contexts().flatMap(context => context.pages()).filter(page => !page.isClosed()).slice(0, 5)) {
        const screenshot = `failure-${name}-${diagnostics.length + 1}.png`;
        const results = await Promise.allSettled([
          page.screenshot({ path: path.join(output, screenshot), timeout: 2500 }),
          page.locator("body").innerText({ timeout: 2500 }),
        ]);
        diagnostics.push({ path: new URL(page.url()).pathname, requests: observations.get(page) ?? [],
          ...(results[0].status === "fulfilled" ? { screenshot } : { screenshotError: "capture failed" }),
          ...(results[1].status === "fulfilled" ? { visibleText: results[1].value.slice(0, 12000) } : { textError: "capture failed" }),
        });
      }
      await writeFile(path.join(output, `browser-report-${name}.json`), JSON.stringify({ ...report, failure: String(error), diagnostics }, null, 2)).catch(() => {});
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
