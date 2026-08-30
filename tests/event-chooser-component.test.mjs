import assert from "node:assert/strict";
import test, { after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { default: EventChooser } = await environment.runner.import("/app/event-chooser.tsx");
after(() => vite.close());

const events = [
  { id: "event-a", name: "第一場活動", venue: "北部展館", dateRangeLabel: "2026-11-07 – 08" },
  { id: "event-b", name: "第二場活動", venue: "南部展館", dateRangeLabel: "2027-02-14" },
];

const render = (properties) => renderToStaticMarkup(
  React.createElement(EventChooser, { events, onSelect: () => undefined, ...properties }),
);

test("every published event is offered with what a reader needs to tell them apart", () => {
  const html = render({});
  for (const event of events) {
    assert.match(html, new RegExp(event.name), `${event.id} must be offered`);
    assert.match(html, new RegExp(event.venue), `${event.id} must show where it is`);
    assert.match(html, new RegExp(event.dateRangeLabel), `${event.id} must show when it is`);
  }
  assert.equal(html.match(/<button/g).length, events.length, "one entry per event, and nothing else to press");
});

test("a link to an event this build does not serve says so instead of opening another one", () => {
  const html = render({ unresolved: "event-c" });
  assert.match(html, /目前無法開啟/);
  // Status, not colour: the reason has to survive a reader who cannot see the
  // amber panel at all.
  assert.match(html, /role="status"/);
  // Naming the missing event would invite reading it as a real event.
  assert.doesNotMatch(html, /event-c/);
  // The way forward is still the list.
  assert.equal(html.match(/<button/g).length, events.length);
});

test("nothing is offered that was not published", () => {
  const html = render({});
  assert.doesNotMatch(html, /event-c|sample-two/);
});
