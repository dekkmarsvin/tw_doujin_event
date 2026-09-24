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

/** The label's on-screen box, the way the renderer lays it out. */
function screenBox(label, scale) {
  const width = mapLabelEms(label.text) * label.fontPx, x = label.x * scale + label.dx, y = label.y * scale + label.dy;
  const left = label.anchor === "start" ? x : label.anchor === "end" ? x - width : x - width / 2;
  return { left, right: left + width, top: y - label.fontPx * .6, bottom: y + label.fontPx * .6 };
}
function assertOnPlan(label, scale, layout, message) {
  const box = screenBox(label, scale), slack = 1e-6;
  assert.ok(box.left >= -slack && box.top >= -slack && box.right <= layout.width * scale + slack && box.bottom <= layout.height * scale + slack, `${message}: ${JSON.stringify(box)}`);
}

test("a facility name that would run off the plan crosses to the other side of its badge", () => {
  // Found in review: a named desk just above the lower edge of a 100-high plan
  // had its name cut in half by the map, and a doorway there lost its name.
  // At 8 px a unit the desk's name below it would end at 807.8 px of 800.
  const scale = 8;
  const plan = hall({
    width: 200, height: 100, rows: [],
    accessPoints: [
      { id: "south-gate", kind: "entrance", direction: "north", x: 40, y: 98, label: "南門" },
      { id: "north-gate", kind: "exit", direction: "north", x: 100, y: 2, label: "北門" },
      { id: "east-gate", kind: "entrance", direction: "west", x: 198, y: 50, label: "東門" },
      { id: "west-gate", kind: "entrance", direction: "east", x: 2, y: 50, label: "西門" },
    ],
    servicePoints: [{ id: "desk", kind: "information", x: 150, y: 97, label: "服務台" }],
  });
  const labels = layoutMapMarkerLabels(plan, { screenScale: scale, fontScale: 1 });
  const expected = { "access:south-gate": "above", "access:north-gate": "below", "access:east-gate": "west", "access:west-gate": "east", "service:desk": "above" };
  for (const [key, side] of Object.entries(expected)) {
    const label = labels.get(key);
    assert.ok(label, `${key} is still drawn`);
    assertOnPlan(label, scale, plan, key);
    if (side === "above") assert.ok(label.dy < 0 && label.anchor === "middle", `${key} moves above its badge`);
    if (side === "below") assert.ok(label.dy > 0 && label.anchor === "middle", `${key} moves below its badge`);
    if (side === "west") assert.ok(label.dx < 0 && label.anchor === "end", `${key} moves left of its badge`);
    if (side === "east") assert.ok(label.dx > 0 && label.anchor === "start", `${key} moves right of its badge`);
  }
  // With room on its own side, a name stays where it always was.
  const roomy = layoutMapMarkerLabels({ ...plan, height: 120 }, { screenScale: scale, fontScale: 1 });
  assert.ok(roomy.get("service:desk").dy > 0 && roomy.get("access:south-gate").dy > 0);
});

test("a name that crossed over still gives way, and is left out only when neither side fits", () => {
  const scale = 8;
  const desk = { id: "desk", kind: "information", x: 100, y: 97, label: "服務台" };
  // A second badge just above takes the space the name would cross into.
  const crowded = layoutMapMarkerLabels(hall({ width: 200, height: 100, rows: [], servicePoints: [desk, { id: "toilet", kind: "toilet", x: 100, y: 93 }] }), { screenScale: scale, fontScale: 1 });
  assert.equal(crowded.has("service:desk"), false, "the other side still goes through the overlap check");
  // A plan too short for the name on either side of the badge.
  const shallow = hall({ width: 200, height: 4, rows: [], servicePoints: [{ ...desk, y: 2 }], accessPoints: [{ id: "gate", kind: "entrance", direction: "north", x: 40, y: 2, label: "入口" }] });
  const labels = layoutMapMarkerLabels(shallow, { screenScale: scale, fontScale: 1 });
  assert.equal(labels.has("service:desk"), false);
  assert.equal(labels.has("access:gate"), false);
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
