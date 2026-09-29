import assert from "node:assert/strict";
import test, { after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { CirclePageShare, writeClipboard } = await environment.runner.import("/app/circle-portal/circle-page-share.tsx");
const { getEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
after(() => vite.close());

// The panel reads the site's own origin; the server render has no window.
globalThis.window = { location: { origin: "https://map.kotoban.top" } };
const event = getEventDefinition("sample");
const circle = { id: "c-900001", name: "北風畫室" };
const record = (day, boothCode, name = circle.name) => ({ circle: { id: circle.id, name }, placement: { id: `${day}-${boothCode}`, eventId: "sample", circleId: circle.id, day, area: "north", boothCode, status: "active", tone: "mint" } });
const render = (props) => renderToStaticMarkup(React.createElement(CirclePageShare, { event, circle, onRetry() {}, ...props }));
const copyButton = (markup) => markup.match(/<button[^>]*>複製宣傳文字與連結<\/button>/)[0];

test("nothing is offered before the booths are known, not even the page link", () => {
  const markup = render({ records: null, failed: false });
  assert.match(markup, /正在準備宣傳文字…/);
  assert.doesNotMatch(markup, /<textarea/, "no half-made post to copy by hand either");
  assert.match(copyButton(markup), /disabled=""/);
  // A circle with no booth has no page, and until the records arrive this
  // could be one: the link stays in place but cannot be followed yet.
  assert.doesNotMatch(markup, /href="https:\/\/map\.kotoban\.top\/events\//);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>查看公開頁<\/button>/);
});

test("a circle with no booth in this event has no page, so nothing is shared", () => {
  assert.equal(render({ records: [], failed: false }), "");
});

test("a failed read says so and offers to fetch again, still without a post", () => {
  const markup = render({ records: null, failed: true });
  assert.match(markup, /無法取得攤位資料，宣傳文字暫時無法產生。/);
  assert.match(markup, /<button[^>]*>重新取得<\/button>/);
  assert.doesNotMatch(markup, /<textarea/);
  assert.match(copyButton(markup), /disabled=""/);
});

test("with the booths in hand the full post is ready to copy", () => {
  const markup = render({ records: [record(1, "S01"), record(2, "S01")], failed: false });
  const post = markup.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)[1];
  assert.match(post, /9月1日（二） S01／9月2日（三） S01/);
  assert.match(post, /https:\/\/map\.kotoban\.top\/events\/sample\/circles\/c-900001\/$/);
  assert.doesNotMatch(copyButton(markup), /disabled/);
  assert.match(markup, /href="https:\/\/map\.kotoban\.top\/events\/sample\/circles\/c-900001\/"[^>]*>查看公開頁/);
});

// The claim keeps the name it was made under; the post follows the official one.
test("the post names the circle as the official records do now", () => {
  const markup = render({ records: [record(1, "S01", "北風畫室（更正）")], failed: false });
  const post = markup.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)[1];
  assert.match(post, /^北風畫室（更正）｜/);
});

// A browser with no Clipboard API must reach the same manual-copy fallback as
// one that refuses the write, so the absence has to arrive as a rejection.
test("a missing clipboard rejects instead of throwing", async () => {
  assert.equal(globalThis.navigator.clipboard, undefined, "this runtime has no Clipboard API, like an insecure page");
  let pending;
  assert.doesNotThrow(() => { pending = writeClipboard("text"); });
  await assert.rejects(pending, TypeError);
});

test("share settings preview the selected page and clearly leave saving to the editor", () => {
  const page = { url: "https://pictures.test/sheet.jpg", previewUrl: "https://pictures.test/small.jpg", width: 1800, height: 2500 };
  const markup = render({ records: [record(1, "S01")], failed: false, onImageChange() {},
    fields: { catalogImages: [page], shareImage: page.url }, savedFields: {} });
  assert.match(markup, /分享縮圖/);
  assert.match(markup, /品書第 1 張/);
  assert.match(markup, /src="https:\/\/pictures.test\/sheet.jpg"/);
  assert.match(markup, /縮圖尚未儲存，請預覽並送出。/);
  assert.doesNotMatch(markup, /社團代表圖/);
});

test("an unchanged share image reads as already applied, not as waiting for a save", () => {
  const markup = render({ records: [record(1, "S01")], failed: false, onImageChange() {}, fields: {}, savedFields: {} });
  assert.match(markup, /已套用到公開頁/);
  assert.doesNotMatch(markup, /儲存後套用|尚未儲存/);
});
