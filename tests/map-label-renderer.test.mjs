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

test("reserved and cancelled tables are named passive marks while an overlapping booth keeps its action", () => {
  const marked = { ...layout, spaceMarks: [
    { id: "empty", kind: "reserved", rect },
    { id: "withdrawn", kind: "cancelled", rect: { x: 60, y: 20, width: 24, height: 24 } },
  ] };
  for (const screenScale of [.25, 6]) {
    const result = output({ layout: marked, markerPresentation: { screenScale, fontScale: 1.24 } });
    const marks = result.nodes.filter(node => result.attr(node, "data-space-mark"));
    assert.deepEqual(marks.map(node => result.attr(node, "aria-label")), ["保留空桌", "取消攤位"]);
    for (const mark of marks) {
      assert.equal(result.attr(mark, "role"), "img");
      assert.equal(result.attr(mark, "tabindex"), undefined);
      assert.equal(result.attr(mark, "data-slot-code"), undefined);
      assert.ok(mark.childNodes.some(node => node.tagName === "title"));
    }
    assert.ok(result.attr(marks[0].childNodes.find(node => node.tagName === "rect"), "stroke-dasharray"));
    assert.equal(marks[0].childNodes.some(node => node.tagName === "path"), false);
    assert.ok(marks[1].childNodes.some(node => node.tagName === "path"), "cancelled has a visible cross");
    assert.equal(result.attr(result.slot, "role"), "button");
    assert.equal(result.attr(result.slot, "tabindex"), "0");
    assert.equal(result.nodes.filter(node => result.attr(node, "role") === "button").length, 1);
  }
});

test("entrances and exits differ in shape, keep their screen size and name themselves", () => {
  const withFacilities = {
    ...layout,
    accessPoints: [
      { id: "in", kind: "entrance", direction: "north", x: 50, y: 95, label: "一般入口" },
      { id: "out", kind: "exit", direction: "north", x: 80, y: 5, label: "活動出口" },
    ],
    landmarks: [{ id: "hq", kind: "other", label: "大會總部", rect: { x: 50, y: 30, width: 40, height: 30 } }],
  };
  for (const screenScale of [.25, 4]) {
    const result = output({ layout: withFacilities, markerPresentation: { screenScale, fontScale: 1 }, locatedMarker: "landmark:hq" });
    const marker = (key) => result.nodes.find((node) => result.attr(node, "data-marker") === key);
    const entrance = marker("access:in");
    const exit = marker("access:out");
    assert.equal(result.attr(entrance, "role"), "img");
    assert.equal(result.attr(entrance, "aria-label"), "一般入口，入口");
    assert.equal(result.attr(exit, "aria-label"), "活動出口，出口");
    assert.ok(result.attr(entrance, "transform").endsWith(`scale(${1 / screenScale})`), "the badge undoes the map's scale");
    assert.ok(entrance.childNodes.some((node) => node.tagName === "circle"), "an entrance is round");
    assert.ok(exit.childNodes.some((node) => node.tagName === "rect"), "an exit is square");
    assert.equal(entrance.childNodes.some((node) => node.tagName === "rect"), false);
    const area = result.nodes.find((node) => result.attr(node, "aria-label") === "大會總部" && result.attr(node, "role") === "img");
    assert.ok(area, "an area names itself even when its label is hidden");
    const located = marker("landmark:hq").childNodes.find((node) => node.tagName === "rect");
    assert.ok(located, "the located area is outlined");
  }
  const plain = output({ layout: withFacilities });
  assert.equal(plain.nodes.filter((node) => node.tagName === "rect" && /located/i.test(plain.attr(node, "class") ?? "")).length, 0, "nothing is outlined until a facility is located");
});

test("service points draw a badge named by type, and a two-way doorway is a diamond", () => {
  const result = output({
    layout: {
      ...layout,
      accessPoints: [{ id: "side", kind: "both", direction: "north", x: 50, y: 95, label: "側門" }],
      servicePoints: [
        { id: "t1", kind: "toilet", x: 20, y: 80 },
        { id: "aid", kind: "first-aid", x: 80, y: 80, label: "北側" },
        { id: "tickets", kind: "ticket-office", x: 20, y: 20 },
        { id: "changing", kind: "changing-room", x: 50, y: 20 },
        { id: "bags", kind: "cloakroom", x: 80, y: 20 },
      ],
    },
    markerPresentation: { screenScale: 2, fontScale: 1 },
    locatedMarker: "service:aid",
  });
  const marker = (key) => result.nodes.find((node) => result.attr(node, "data-marker") === key);
  assert.equal(result.attr(marker("service:t1"), "aria-label"), "廁所");
  assert.equal(result.attr(marker("service:aid"), "aria-label"), "北側，醫護站");
  assert.equal(result.attr(marker("service:t1"), "role"), "img");
  for (const [id, name] of [["tickets", "售票處"], ["changing", "更衣室"], ["bags", "寄物處"]]) {
    assert.equal(result.attr(marker(`service:${id}`), "aria-label"), name);
    assert.equal(result.attr(marker(`service:${id}`), "role"), "img");
  }
  assert.ok(marker("service:aid").childNodes.some((node) => node.tagName === "circle" && /located/i.test(result.attr(node, "class") ?? "")), "the located service point is ringed");
  const side = marker("access:side");
  assert.equal(result.attr(side, "aria-label"), "側門，出入兩用");
  assert.equal(side.childNodes.some((node) => node.tagName === "circle" || node.tagName === "rect"), false, "a two-way doorway is neither round nor square");
  assert.equal(output({ layout }).nodes.some((node) => result.attr(node, "aria-label") === "服務設施"), false, "a map without service points draws no service layer");
});

test("explicit row label sides render with the shared edge anchors without changing booth controls", () => {
  for (const [labelSide, anchor] of [["above", "middle"], ["below", "middle"], ["left", "end"], ["right", "start"]]) {
    const sideLayout = { ...layout, width: 400, height: 300, rows: [{ ...layout.rows[0], labelSide, slots: [{ code: "A01", rect: { x: 160, y: 120, width: 24, height: 24 } }] }] };
    const result = output({ layout: sideLayout });
    const marker = result.nodes.find(node => result.attr(node, "data-marker") === "row:A");
    const label = marker.childNodes.find(node => node.tagName === "text");
    assert.equal(result.attr(label, "text-anchor"), anchor);
    assert.equal(result.attr(result.slot, "role"), "button");
    assert.equal(result.attr(result.slot, "aria-label"), "A01 完整社團名稱，已收藏");
  }
});
