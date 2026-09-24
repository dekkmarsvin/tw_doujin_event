import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { layoutMapMarkerLabels, accessLabelSide, mapLabelEms } = await environment.runner.import("/app/map-marker-presentation.ts");
const { mapFacilityDirectory } = await environment.runner.import("/app/map-facility-directory.ts");
const { rowLabelAnchor, rowLabelPlacement } = await environment.runner.import("/app/event-map.ts");
after(() => vite.close());

const slot = (code, x, y) => ({ code, rect: { x, y, width: 20, height: 14 } });
const hall = (overrides = {}) => ({
  width: 2000, height: 1200,
  rows: [{ label: "A", orientation: "vertical", confidence: 1, slots: [slot("A01", 400, 300), slot("A02", 400, 314)] }],
  accessPoints: [], landmarks: [], pillars: [],
  ...overrides,
});
const entrance = (id, x, label = "一般入口", direction = "north") => ({ id, kind: "entrance", direction, x, y: 1100, label });

test("labels keep a readable size on a fitted map and stop growing when zoomed in", () => {
  const layout = hall({ accessPoints: [entrance("in", 1000)], landmarks: [{ id: "stage", kind: "stage", label: "舞台", rect: { x: 1200, y: 200, width: 400, height: 300 } }] });
  const overview = layoutMapMarkerLabels(layout, { screenScale: .12, fontScale: 1 });
  assert.equal(overview.get("access:in").fontPx, 11);
  assert.equal(overview.get("row:A").fontPx, 12);
  assert.equal(overview.get("landmark:stage").fontPx, 11);
  const close = layoutMapMarkerLabels(layout, { screenScale: 3.4, fontScale: 1 });
  assert.equal(close.get("access:in").fontPx, 14);
  assert.equal(close.get("row:A").fontPx, 28);
  assert.equal(close.get("landmark:stage").fontPx, 16);
  const extra = layoutMapMarkerLabels(layout, { screenScale: .12, fontScale: 1.24 });
  assert.equal(extra.get("access:in").fontPx, 11 * 1.24);
  assert.equal(extra.get("row:A").fontPx, 12 * 1.24);
});

test("an access point's name faces out of the hall", () => {
  assert.equal(accessLabelSide({ kind: "entrance", direction: "north" }), "south");
  assert.equal(accessLabelSide({ kind: "exit", direction: "north" }), "north");
  assert.equal(accessLabelSide({ kind: "entrance", direction: "east" }), "west");
  const labels = layoutMapMarkerLabels(hall({ accessPoints: [entrance("in", 600), { id: "out", kind: "exit", direction: "north", x: 1400, y: 100, label: "活動出口" }] }), { screenScale: 1, fontScale: 1 });
  assert.ok(labels.get("access:in").dy > 11, "an entrance's name sits below its badge");
  assert.ok(labels.get("access:out").dy < -11, "an exit's name sits above its badge");
  const west = layoutMapMarkerLabels(hall({ accessPoints: [entrance("side", 1000, "側門", "east")] }), { screenScale: 1, fontScale: 1 }).get("access:side");
  assert.equal(west.anchor, "end");
  assert.ok(west.dx < 0);
});

test("a name that would overlap one already placed is left out, and badges are never covered", () => {
  const layout = hall({ accessPoints: [entrance("first", 1000, "電子福袋入口"), entrance("second", 1100, "電子福袋入口 2")] });
  const fitted = layoutMapMarkerLabels(layout, { screenScale: .12, fontScale: 1 });
  assert.ok(fitted.has("access:first"));
  assert.equal(fitted.has("access:second"), false, "at 12 px apart the second name cannot fit");
  const zoomed = layoutMapMarkerLabels(layout, { screenScale: 1.5, fontScale: 1 });
  assert.ok(zoomed.has("access:first") && zoomed.has("access:second"), "zooming in makes room for both");
  const crowded = layoutMapMarkerLabels(hall({
    rows: [{ label: "B", orientation: "horizontal", confidence: 1, slots: [slot("B01", 990, 1060)] }],
    accessPoints: [entrance("gate", 1000, "")],
  }), { screenScale: .5, fontScale: 1 });
  assert.equal(crowded.has("row:B"), false, "a row name that would sit on a badge gives way");
});

test("an area name must fit inside its own area", () => {
  const areas = [
    { id: "wide", kind: "other", label: "大會總部", rect: { x: 100, y: 100, width: 400, height: 200 } },
    { id: "narrow", kind: "other", label: "大會總部", rect: { x: 700, y: 100, width: 40, height: 300 } },
  ];
  const labels = layoutMapMarkerLabels(hall({ rows: [], landmarks: areas }), { screenScale: .4, fontScale: 1 });
  const wide = labels.get("landmark:wide");
  assert.ok(wide && wide.fontPx >= 11 && wide.fontPx * mapLabelEms(wide.text) <= 400 * .4);
  assert.equal(labels.has("landmark:narrow"), false);
});

test("a name at the edge of the plan slides back onto it", () => {
  const labels = layoutMapMarkerLabels(hall({ rows: [], accessPoints: [entrance("corner", 10, "快速入場／貴賓入口")] }), { screenScale: .12, fontScale: 1 });
  const label = labels.get("access:corner");
  const left = label.x * .12 + label.dx - mapLabelEms(label.text) * label.fontPx / 2;
  assert.ok(Math.abs(left) < 1e-9, "the label starts at the plan's left edge");
});

test("row names start at the same gap the editor draws them at", () => {
  const vertical = { orientation: "vertical", slots: [slot("A01", 100, 200)] };
  const horizontal = { orientation: "horizontal", slots: [slot("W01", 100, 200)] };
  assert.deepEqual(rowLabelPlacement(vertical), { x: 110, y: 187, side: "above" });
  assert.deepEqual(rowLabelPlacement(horizontal), { x: 110, y: 227, side: "below" });
  assert.deepEqual(rowLabelAnchor(vertical), { x: 110, y: 187 });
  assert.deepEqual(rowLabelAnchor(horizontal), { x: 110, y: 244 });
  const labels = layoutMapMarkerLabels(hall({ rows: [{ label: "W", confidence: 1, ...horizontal }, { label: "A", confidence: 1, ...vertical }] }), { screenScale: 1, fontScale: 1 });
  assert.ok(labels.get("row:W").dy > 0, "below a horizontal row the name grows downward");
  assert.ok(labels.get("row:A").dy < 0, "above a vertical row the name grows upward");
});

test("the facility list names each access point and each uniquely named area, and explains shared names in the legend", () => {
  const blocks = Array.from({ length: 3 }, (_, index) => ({ id: `e${index}`, kind: "enterprise", label: "企業攤", rect: { x: index * 100, y: 0, width: 80, height: 60 } }));
  const directory = mapFacilityDirectory({
    accessPoints: [entrance("in", 100, "一般入口"), { id: "out", kind: "exit", direction: "north", x: 500, y: 10, label: "活動出口" }, entrance("blank", 300, "  ")],
    landmarks: [...blocks, { id: "hq", label: "大會總部", rect: { x: 0, y: 200, width: 40, height: 120 } }, { id: "stage", kind: "stage", label: "舞台", rect: { x: 300, y: 200, width: 100, height: 100 } }],
    pillars: [{ id: "p1", x: 0, y: 0, width: 10, height: 10 }],
  });
  assert.deepEqual(directory.entries.map((entry) => [entry.key, entry.label, entry.ariaLabel]), [
    ["access:in", "一般入口", "一般入口"],
    ["access:out", "活動出口", "活動出口"],
    ["landmark:hq", "大會總部", "大會總部，區域"],
    ["landmark:stage", "舞台", "舞台"],
  ]);
  assert.deepEqual(directory.entries.find((entry) => entry.key === "landmark:hq").point, { x: 20, y: 260 });
  assert.deepEqual(directory.legend.map((item) => item.label), ["入口", "出口", "柱子", "企業攤"]);
  const empty = mapFacilityDirectory({ accessPoints: [], landmarks: blocks, pillars: [] });
  assert.equal(empty.entries.length, 0, "a map with only shared names offers nothing to locate");
});

test("service points name themselves by type and are grouped so the toilets sit together", () => {
  const directory = mapFacilityDirectory({
    accessPoints: [{ id: "side", kind: "both", direction: "east", x: 10, y: 10, label: "側門" }],
    landmarks: [], pillars: [],
    servicePoints: [
      { id: "t1", kind: "toilet", x: 10, y: 20 },
      { id: "desk", kind: "information", x: 30, y: 20, label: "大會服務台" },
      { id: "t2", kind: "toilet", x: 50, y: 20, label: "女廁" },
    ],
  });
  assert.deepEqual(directory.entries.map((entry) => [entry.key, entry.group, entry.label, entry.ariaLabel]), [
    ["access:side", "access", "側門", "側門，出入兩用"],
    ["service:t1", "service", "廁所", "廁所"],
    ["service:t2", "service", "女廁", "女廁，廁所"],
    ["service:desk", "service", "大會服務台", "大會服務台"],
  ]);
  assert.deepEqual(directory.legend.map((item) => item.label), ["出入兩用", "廁所", "服務台"]);
});

test("a service point badge is an obstacle, and only a name of its own is drawn", () => {
  const layout = hall({
    rows: [],
    accessPoints: [entrance("in", 1000, "一般入口")],
    servicePoints: [{ id: "t1", kind: "toilet", x: 1000, y: 1140 }, { id: "t2", kind: "toilet", x: 400, y: 600, label: "女廁" }],
  });
  const fitted = layoutMapMarkerLabels(layout, { screenScale: .5, fontScale: 1 });
  assert.equal(fitted.has("service:t1"), false, "an unnamed service point has no text");
  assert.equal(fitted.has("access:in"), false, "a name that would cover a service badge gives way");
  const named = fitted.get("service:t2");
  assert.ok(named && named.dy > 11 && named.anchor === "middle", "a service name sits below its badge");
  assert.equal(accessLabelSide({ kind: "both", direction: "north" }), "south", "a two-way doorway is named like an entrance");
});
