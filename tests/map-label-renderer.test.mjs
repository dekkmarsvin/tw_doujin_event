import assert from "node:assert/strict";
import test, { after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, isRunnableDevEnvironment } from "vite";
import { parseFragment } from "parse5";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("SSR environment unavailable");
const { default: Renderer } = await environment.runner.import("/app/accessible-event-map-renderer.tsx");
after(() => vite.close());
const rect = { x: 10, y: 20, width: 24, height: 24 };
const layout = { width: 100, height: 100, floor: { x: 0, y: 0, width: 100, height: 100 }, rows: [{ label: "A", orientation: "horizontal", slots: [{ code: "A01", rect }] }], pillars: [], landmarks: [], accessPoints: [] };
const presentation = { screenScale: 1, targetPx: 12, paddingPx: 2 };
function output(props = {}) {
  const html = renderToStaticMarkup(React.createElement(Renderer, { eventName: "Test", layout, slots: { A01: { ariaLabel: "A01 完整社團名稱，已收藏", favorite: true } }, onSelect() {}, ...props }));
  const nodes = [];
  const walk = (node) => { nodes.push(node); node.childNodes?.forEach(walk); };
  walk(parseFragment(html));
  const attr = (node, key) => node.attrs?.find((item) => item.name === key)?.value;
  return { html, nodes, attr, slot: nodes.find((node) => attr(node, "data-slot-code") === "A01") };
}

test("pictureless slots retain mobile labels and gain bounded desktop labels without media elements", () => {
  for (const showMedia of [false, true]) {
    const mobile = output({ showMedia });
    assert.equal(mobile.nodes.filter((node) => node.tagName === "image" || node.tagName === "clipPath").length, 0);
    assert.equal(mobile.attr(mobile.slot.childNodes.find((node) => node.tagName === "text"), "y"), String(rect.y + rect.height * .69));
    const desktop = output({ showMedia, labelPresentation: presentation });
    const label = desktop.slot.childNodes.find((node) => node.tagName === "text");
    assert.equal(desktop.attr(label, "y"), "32");
    assert.match(desktop.attr(label, "style"), /font-size:10/);
    assert.ok(desktop.attr(label, "clip-path"));
    assert.equal(desktop.nodes.filter((node) => node.tagName === "image").length, 0);
  }
});

test("small overviews keep the code, only shrinking it, and keep state marks", () => {
  const result = output({ labelPresentation: { ...presentation, screenScale: .3 } });
  const label = result.slot.childNodes.find((node) => node.tagName === "text");
  assert.match(result.attr(label, "style"), /font-size:[\d.]+/);
  assert.equal(result.attr(label, "y"), String(rect.y + rect.height * .5));
  assert.match(result.attr(result.slot, "aria-label"), /A01 完整社團名稱/);
  assert.ok(result.slot.childNodes.some((node) => node.tagName === "circle"));
  assert.equal(result.attr(result.slot, "tabindex"), "0");
});

test("a thumbnail moves the code into the shaded band instead of dropping it", () => {
  const result = output({ labelPresentation: presentation, showMedia: true, slots: { A01: { ariaLabel: "A01 完整社團名稱，已收藏", favorite: true, thumbnailUrl: "https://example.com/a.png" } } });
  const shade = result.slot.childNodes.filter((node) => node.tagName === "rect").at(-1);
  const label = result.slot.childNodes.find((node) => node.tagName === "text");
  const band = { y: Number(result.attr(shade, "y")), height: Number(result.attr(shade, "height")) };
  assert.equal(Number(result.attr(label, "y")), band.y + band.height / 2);
  assert.match(result.attr(label, "style"), /font-size:[\d.]+/);
  assert.ok(result.slot.childNodes.some((node) => node.tagName === "image"));
});
