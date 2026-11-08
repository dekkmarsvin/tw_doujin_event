import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const { cardGeometry, cardPointToMap, pointOnRoute, routePoints } = await vite.environments.ssr.runner.import("/app/booth-guide/card.ts");
const { guidePlacements } = await vite.environments.ssr.runner.import("/app/booth-guide/placements.ts");
after(() => vite.close());

const layout = {
  width: 1200, height: 1400, floor: { x: 100, y: 100, width: 1000, height: 1200 },
  rows: [{ label: "A", orientation: "vertical", slots: [{ code: "A01", rect: { x: 900, y: 800, width: 50, height: 300 } }] }],
  pillars: [], landmarks: [], accessPoints: [{ x: 200, y: 1200, label: "南入口", kind: "entrance" }],
};
const scene = {
  settings: { format: "portrait", closeup: true, showQr: true, booth: "A01", entrance: "南入口" },
  mapSize: layout, picture: { width: 100, height: 100 }, qr: Array.from({ length: 45 }, () => Array(45).fill(false)),
  start: { x: 200, y: 1200 }, target: { x: 925, y: 1050 }, waypoints: [{ x: 200, y: 1150 }, { x: 925, y: 1150 }], route: true,
};
const contains = (r, p) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test("the portal offers only this circle's active placements in the event's dated venue scopes", () => {
  const event = { id: "event", days: [{ id: 1 }, { id: 2 }], venueAssignments: [
    { venueSpaceId: "north-hall", areaIds: ["north"] }, { venueSpaceId: "south-hall", areaIds: ["south"] },
  ] };
  const record = (id, changes = {}) => ({ placement: { id, eventId: "event", circleId: "mine", day: 1, area: "north", status: "active", ...changes } });
  const choices = guidePlacements(event, "mine", [
    record("day2", { day: 2, area: "south" }), record("day1"), record("cancelled", { status: "cancelled" }),
    record("moved", { status: "moved" }), record("other-circle", { circleId: "another" }),
    record("other-event", { eventId: "another" }), record("missing-day", { day: 3 }),
  ]);
  assert.deepEqual(choices.map(item => [item.placement.id, item.venue.venueSpaceId]), [["day1", "north-hall"], ["day2", "south-hall"]]);
});

function assertReferencesVisible(input) {
  const g = cardGeometry(input);
  for (const p of [...routePoints(input), { x: 925, y: 787 }]) assert.ok(contains(g.crop, p), "route and row heading stay within the crop");
  assert.ok(g.labels.some(label => label.text === "A"));
  assert.ok(g.labels.some(label => label.text === "南入口"));
  assert.ok(contains(g.mapBox, g.qrBox));
  assert.ok(contains(g.mapBox, { x: g.qrBox.x + g.qrBox.width, y: g.qrBox.y + g.qrBox.height }));
  for (const label of g.labels) assert.ok(!intersects(g.qrBox, label.rect), "QR leaves navigation labels visible");
  for (let i = 0; i <= 1000; i++) assert.ok(!contains(g.qrBox, g.project(pointOnRoute(routePoints(input), i / 1000))), "QR leaves the whole animated route visible");
  return g;
}

test("4:5 route crop preserves the entrance, row heading and destination around an overlaid QR", () => {
  const g = assertReferencesVisible(scene);
  assert.equal(g.width / g.height, 4 / 5);
  const projected = g.project(scene.waypoints[0]);
  const restored = cardPointToMap(scene, projected);
  assert.ok(Math.hypot(restored.x - scene.waypoints[0].x, restored.y - scene.waypoints[0].y) < .0001);
});

test("crowded map corners make space for QR without hiding the route or labels", () => {
  assertReferencesVisible({ ...scene, mapSize: { ...layout, landmarks: [{ rect: { x: 0, y: 0, width: 1200, height: 1400 } }] } });
});

test("a destination at the head of its row keeps both the row name and approach route legible", () => {
  const input = { ...scene, settings: { ...scene.settings, booth: "A22" },
    target: { x: 925, y: 809 }, waypoints: [{ x: 200, y: 720 }, { x: 925, y: 720 }] };
  const g = cardGeometry(input);
  assert.ok(g.labels.some(label => label.text === "A"));
  assert.ok(g.labels.some(label => label.text === "南入口"));
  for (const [i, label] of g.labels.entries()) {
    for (const other of g.labels.slice(i + 1)) assert.ok(!intersects(label.rect, other.rect), "labels don't cover each other");
    for (let n = 0; n <= 1000; n++) assert.ok(!contains(label.rect, g.project(pointOnRoute(routePoints(input), n / 1000))), "labels don't hide the approach route");
  }
});

test("all existing formats keep the QR within the map with and without a picture", () => {
  for (const format of ["portrait", "square", "landscape"]) for (const picture of [scene.picture, null]) {
    assertReferencesVisible({ ...scene, picture, settings: { ...scene.settings, format } });
  }
});
