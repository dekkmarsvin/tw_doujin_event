import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { parse } from "parse5";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite test environment missing.");
const { getEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
const { discoveryPages } = await environment.runner.import("/app/static-discovery.ts");
const { CIRCLE_PAGE_ACTIONS_ID, CIRCLE_PAGE_DATA_ID, CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE, CIRCLE_PAGE_ROOT_ID, circlePageData, readCirclePageData } = await environment.runner.import("/app/circle-page-data.ts");
const { circlePromotion, visitableDays } = await environment.runner.import("/app/circle-share.ts");
after(() => vite.close());

const event = getEventDefinition("sample");
const catalog = JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url), "utf8"));
const nodes = (node) => [node, ...(node.childNodes ?? []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find((attr) => attr.name === name)?.value;
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
const placement = (day, boothCode, status = "active", area = "north") => ({ day, area, boothCode, status });

test("a circle page carries its own official slice and nothing else", () => {
  const changed = structuredClone(catalog);
  changed.circles[0].saleInfo = "PRIVATE_OVERLAY_SENTINEL";
  changed.circles[0].media = [{ url: "https://private.test/image.jpg" }];
  changed.placements[0].note = "PRIVATE_PLACEMENT_SENTINEL";
  const slice = circlePageData(changed, "c-900001");
  assert.deepEqual(slice.circles, [{ id: "c-900001", name: "北風畫室" }]);
  assert.deepEqual(slice.placements.map((item) => item.id), ["1-s01", "2-s01"], "every placement of this circle, and only those");
  assert.doesNotMatch(JSON.stringify(slice), /SENTINEL|private\.test/);
  assert.throws(() => circlePageData(catalog, "c-999999"));
});

test("the slice survives the page it is embedded in, and nothing else is accepted", () => {
  const hostile = structuredClone(catalog);
  hostile.circles[0].name = "</script><img src=x onerror=alert(1)>";
  const html = discoveryPages(event, hostile, { circlePageAssets: '<script type="module" src="/assets/circlePage-test.js"></script>' })
    .get("/events/sample/circles/c-900001/");
  const elements = nodes(parse(html));
  const island = elements.find((node) => attr(node, "id") === CIRCLE_PAGE_DATA_ID);
  assert.equal(attr(island, "type"), "application/json");
  assert.doesNotMatch(html, /<\/script><img/, "a name cannot close the data element");
  const data = readCirclePageData(text(island));
  assert.equal(data.circles[0].name, hostile.circles[0].name, "the name reads back exactly");
  assert.equal(data.placements[0].day, 1, "a numeric day stays numeric, as the map writes it");
  assert.ok(elements.some((node) => attr(node, "id") === CIRCLE_PAGE_ROOT_ID));
  assert.ok(elements.some((node) => node.tagName === "script" && attr(node, "src") === "/assets/circlePage-test.js"));
  const claim = elements.find((node) => node.tagName === "a" && text(node) === "認領／管理資料");
  assert.equal(attr(claim, "href"), "/circle?event=sample&circle=c-900001", "a circle arriving here can reach its own portal");

  assert.equal(readCirclePageData(""), null);
  assert.equal(readCirclePageData("{not json"), null);
  assert.equal(readCirclePageData(JSON.stringify(catalog)), null, "a whole catalog is not one circle's page");
});

test("booths read as one card per day and place, with one plan slot per day", () => {
  const busy = structuredClone(catalog);
  const at = (id, day, area, boothCode, status = "active", tone = "mint") => ({ id, circleId: "c-900001", day, area, boothCode, status, tone });
  busy.placements = [
    at("2-s01", 2, "north", "S01", "moved"),
    at("1-s02", 1, "north", "S02"),
    at("1-s05", 1, "south", "S05", "active", "blue"),
    at("2-s03", 2, "north", "S03"),
    at("1-s01", 1, "north", "S01"),
    { ...catalog.placements.find((placement) => placement.circleId === "c-900002") },
  ];
  const elements = nodes(parse(discoveryPages(event, busy).get("/events/sample/circles/c-900001/")));
  const cards = elements.filter((node) => node.tagName === "li" && (attr(node, "class") ?? "").split(" ").includes("booth-card"));
  const read = (card) => {
    const inside = nodes(card);
    const find = (name) => inside.find((node) => attr(node, "class") === name);
    return {
      when: text(find("booth-when")),
      codes: inside.filter((node) => (attr(node, "class") ?? "").startsWith("booth-code ")).map((node) => [text(node), attr(node, "class").split(" ")[1]]),
      status: find("status") ? text(find("status")) : "",
      retired: attr(card, "class").includes("retired"),
      plan: inside.find((node) => attr(node, CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE) !== undefined) ? attr(inside.find((node) => attr(node, CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE) !== undefined), CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE) : null,
      map: inside.filter((node) => node.tagName === "a").map((node) => new URL(attr(node, "href"), "https://example.test").searchParams.get("selectedBooth")),
    };
  };
  assert.deepEqual(cards.map(read), [
    { when: "9月1日（二）", codes: [["S01", "tone-mint"], ["S02", "tone-mint"]], status: "", retired: false, plan: "1", map: ["S01"] },
    { when: "9月1日（二）", codes: [["S05", "tone-blue"]], status: "", retired: false, plan: null, map: ["S05"] },
    { when: "9月2日（三）", codes: [["S03", "tone-mint"]], status: "", retired: false, plan: "2", map: ["S03"] },
    { when: "9月2日（三）", codes: [["S01", "tone-mint"]], status: "已移動攤位", retired: true, plan: null, map: ["S01"] },
  ], "booths side by side share a card, another place or a retired booth gets its own, and each day offers one plan action");
  assert.ok(elements.some((node) => attr(node, "id") === CIRCLE_PAGE_ACTIONS_ID), "the bar under the name has its place");
});

test("every introduction page opens with the public header, its sign-in keeping the page's context", () => {
  const pages = discoveryPages(event, catalog);
  for (const [path, login] of [["/events/sample/", "/circle?event=sample"], ["/events/sample/circles/c-900001/", "/circle?event=sample&circle=c-900001"]]) {
    const elements = nodes(parse(pages.get(path)));
    const body = elements.find((node) => node.tagName === "body");
    const first = body.childNodes.find((node) => node.tagName);
    assert.equal(first.tagName, "header", `${path}: the header is the first thing on the page`);
    assert.equal(elements.filter((node) => node.tagName === "header").length, 1, path);
    const links = nodes(first).filter((node) => node.tagName === "a");
    assert.deepEqual(links.map((node) => attr(node, "href")), ["/", login], `${path}: the brand leads home, 登入 keeps the context`);
    assert.equal(text(links[1]), "登入");
    assert.ok(elements.some((node) => node.tagName === "link" && attr(node, "href") === "/site-header.css"), `${path} loads the header's stylesheet`);
  }
});

test("only circle pages load the page script", () => {
  const pages = discoveryPages(event, catalog, { circlePageAssets: '<script type="module" src="/assets/circlePage-test.js"></script>' });
  assert.doesNotMatch(pages.get("/events/sample/"), /circlePage-test|circle-page-data/);
  for (const [path, html] of pages) {
    if (path.includes("/circles/")) assert.match(html, /circlePage-test/, path);
  }
});

test("a reader plans only the days a circle can be visited, earliest first", () => {
  const days = visitableDays(event, [
    placement(2, "S01"),
    placement(1, "S01"),
    placement(1, "S03"),
    placement(2, "S09", "cancelled"),
  ]);
  assert.deepEqual(days.map(({ day, label, placements }) => [day, label, placements.map((item) => item.boothCode)]), [
    [1, "9月1日（二）", ["S01", "S03"]],
    [2, "9月2日（三）", ["S01"]],
  ]);
  assert.deepEqual(visitableDays(event, [placement(1, "S01", "moved"), placement(2, "S01", "cancelled")]), [], "a circle with nowhere to go offers no day");
  assert.equal(visitableDays(getEventDefinition("sample-two"), [placement("thu", "T01", "active", "all")])[0].day, "thu", "a string day stays a string");
});

test("the ready-made post is official facts and the page address only", () => {
  const promotion = circlePromotion(event, { id: "c-900001", name: "北風畫室" }, [
    placement(1, "S01"), placement(2, "S01"), placement(2, "S07", "moved"),
  ], "https://map.kotoban.top");
  assert.equal(promotion.url, "https://map.kotoban.top/events/sample/circles/c-900001/");
  assert.equal(promotion.full, `${promotion.text}\n${promotion.url}`);
  const [headline, booths] = promotion.text.split("\n");
  assert.equal(headline, `北風畫室｜${event.name}`);
  assert.match(booths, /^9月1日（二） S01／9月2日（三） S01｜/, "a moved booth is not advertised");
  assert.ok(booths.endsWith(event.venueAssignments[0].venueName));

  const aliased = circlePromotion({ ...event, aliases: ["範例市集"] }, { id: "c-900001", name: "北風畫室" }, [], "https://map.kotoban.top");
  assert.equal(aliased.text, `北風畫室｜${event.name}（範例市集）`, "no placements, no booth line");
});

test("across venues, each date names the venue its booths are in", () => {
  const [assignment] = event.venueAssignments;
  const split = { ...event, venueAssignments: [
    { ...assignment, venueName: "甲館", areaIds: ["north"] },
    { ...assignment, venueId: "venue-b", venueName: "乙館", areaIds: ["south"] },
  ] };
  const booths = (placements) => circlePromotion(split, { id: "c-900001", name: "北風畫室" }, placements, "https://map.kotoban.top").text.split("\n")[1];
  assert.equal(booths([placement(1, "S01"), placement(2, "S02", "active", "south")]), "9月1日（二） 甲館 S01／9月2日（三） 乙館 S02");
  assert.equal(booths([placement(1, "S01"), placement(1, "S03"), placement(1, "S02", "active", "south")]), "9月1日（二） 甲館 S01、S03；乙館 S02", "one day in two venues keeps each booth with its venue");
  assert.equal(booths([placement(1, "S01"), placement(2, "S01")]), "9月1日（二） S01／9月2日（三） S01｜甲館", "one venue is named once");
});
