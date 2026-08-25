import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function readTextAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(entries.map(async (entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return readTextAssets(url);
    if (!/\.(?:css|html|js)$/.test(entry.name)) return [];
    return [await readFile(url, "utf8")];
  }));
  return contents.flat();
}

test("builds the staged application as a Cloudflare Pages SPA", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>場刊 Map｜同人展逛攤地圖<\/title>/i);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/assets\/index-[^"']+\.js/);

  const publicAssets = (await readTextAssets(new URL("../dist/", import.meta.url))).join("\n");
  assert.match(publicAssets, /\/data\/events\//);
  assert.doesNotMatch(publicAssets, /\/api\/events\/|發布活動地圖|MapAdminImporter/);

  // The catalog ships as a fetched snapshot, never inlined into the bundle.
  const scripts = await readTextAssets(new URL("../dist/assets/", import.meta.url));
  const bundle = scripts.join("\n");
  assert.doesNotMatch(bundle, /BASE_BOOTHS|V_W_BOOTHS|FF47_OFFICIAL_NAME_BOOTHS/);
  assert.doesNotMatch(bundle, /"sourceRow":|完整品項與庫存請以現場公告為準/);
  // Measure only what the reader actually loads. The circle portal is a second
  // entry sharing dist/assets/, so a total would let reader bloat hide behind a
  // shrinking portal — and vice versa.
  const readerAssets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(readerAssets.some((path) => path.endsWith(".js")), "index.html must reference a script");
  const readerBytes = (await Promise.all(readerAssets.map(async (path) =>
    Buffer.byteLength(await readFile(new URL(`../dist${path}`, import.meta.url), "utf8"), "utf8")))).reduce((total, size) => total + size, 0);
  assert.ok(readerBytes < 900_000, `reader bundle grew to ${readerBytes} bytes; keep event data in the catalog snapshot.`);

  // The portal must have its own entry, and none of its code may ride along in
  // a chunk the reader loads. Check content, not filenames: Rollup names the
  // shared chunk after a module inside it, so a name match proves nothing.
  const portalHtml = await readFile(new URL("../dist/circle.html", import.meta.url), "utf8");
  const portalAssets = [...portalHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(portalAssets.some((path) => !readerAssets.includes(path)), "the portal must have its own entry chunk");

  const readerJs = (await Promise.all(readerAssets.filter((path) => path.endsWith(".js"))
    .map((path) => readFile(new URL(`../dist${path}`, import.meta.url), "utf8")))).join("\n");
  assert.doesNotMatch(readerJs, /\/api\/auth\/|\/api\/claims|\/api\/admin\//, "the reader must not carry write endpoints");
  assert.doesNotMatch(readerJs, /寄出登入連結|認領社團|__Host-ff47_session/);

  const catalog = JSON.parse(await readFile(new URL("../dist/data/events/sample/circles.json", import.meta.url), "utf8"));
  const sourceCatalog = JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url), "utf8"));
  assert.equal(catalog.schema, "circle-catalog/3");
  assert.equal(catalog.eventId, "sample");
  assert.deepEqual(catalog.circles, sourceCatalog.circles);
  assert.deepEqual(catalog.placements, sourceCatalog.placements);
  assert.equal(catalog.circles.length, 2);
  for (const retired of ["booths", "templates", "officialSupplementKeys"]) assert.equal(Object.hasOwn(catalog, retired), false);

  const snapshot = JSON.parse(await readFile(new URL("../dist/data/events/sample/map.json", import.meta.url), "utf8"));
  const sourceSnapshot = JSON.parse(await readFile(new URL("../fixtures/events/sample/map.json", import.meta.url), "utf8"));
  assert.equal(snapshot.eventId, "sample");
  assert.ok(Number.isSafeInteger(snapshot.revision) && snapshot.revision > 0);
  assert.equal(snapshot.revision, sourceSnapshot.revision);
  assert.equal(snapshot.layout.rows.reduce((total, row) => total + row.slots.length, 0), 2);
  assert.equal(snapshot.layout.pillars.length, 0);
  assert.equal(snapshot.layout.accessPoints.length, 0);
  assert.equal(snapshot.layout.landmarks.length, 0);

  await assert.rejects(readFile(new URL("../dist/_worker.js", import.meta.url), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(new URL("../dist/_redirects", import.meta.url), "utf8"), { code: "ENOENT" });
  assert.match(await readFile(new URL("../dist/404.html", import.meta.url), "utf8"), /找不到這個頁面/);

  // The notice ships as part of the build, and the portal links to it from the
  // sign-in card — before the address is handed over, which is the whole point
  // (#30). Deliberately absent from the precache manifest: a policy document
  // pinned into an offline shell is a policy document a reader can be shown
  // after it has been superseded.
  const privacy = await readFile(new URL("../dist/privacy/index.html", import.meta.url), "utf8");
  assert.match(privacy, /<title>隱私權與資料使用告知｜場刊 Map<\/title>/);
  assert.doesNotMatch(privacy, /<script/i);
  assert.ok(portalAssets.some((path) => path.endsWith(".js")), "the portal must ship a script");
  const portalJs = (await Promise.all(portalAssets.filter((path) => path.endsWith(".js"))
    .map((path) => readFile(new URL(`../dist${path}`, import.meta.url), "utf8")))).join("\n");
  // Quoting is the minifier's choice, so match either form.
  assert.match(portalJs, /["'`]\/privacy["'`]/, "the sign-in card must link to the notice");
  assert.match(portalJs, /代表圖網址限使用以下圖片主機/, "the portal must explain the supported image hosts");
  assert.match(portalJs, /社團主題類別/, "the portal must ship the organizer-category selector");
  assert.match(portalJs, /尚未選擇/, "the category selector must represent the unselected state");
  assert.doesNotMatch(portalJs, /IP 暴露/, "the portal must not turn ordinary image loading into an IP-exposure warning");
  assert.doesNotMatch(await readFile(new URL("../dist/sw.js", import.meta.url), "utf8"), /privacy/);
  assert.match(await readFile(new URL("../dist/fonts/geist.css", import.meta.url), "utf8"), /font-family: "Geist"/);
});

test("circle category controls consume event data rather than organizer constants", async () => {
  const [portal, reader] = await Promise.all([
    readFile(new URL("../app/circle-portal/portal-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/event-map-app.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(portal, /ACTIVE_EVENT\.circleCategories\.categories\.map/);
  assert.match(portal, /ACTIVE_EVENT\.circleCategories\.sources\.map/);
  assert.match(reader, /const GENRES: readonly string\[\] = ACTIVE_EVENT\.genres/);
  for (const organizerSpecificLabel of ["總合動漫畫", "東方Project", "學校漫研"]) {
    assert.doesNotMatch(portal, new RegExp(organizerSpecificLabel));
    assert.doesNotMatch(reader, new RegExp(organizerSpecificLabel));
  }
});

test("map reviewers can inspect the authenticated evidence bytes before approval", async () => {
  const panel = await readFile(new URL("../app/circle-portal/map-contribution-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /\/api\/map-contributions\/files\/\$\{encodeURIComponent\(item\.id\)\}/);
  assert.match(panel, /預覽上傳檔/);
  assert.match(panel, /下載上傳檔/);
  assert.match(panel, /item\.mime\.startsWith\("image\/"\)/);
  assert.match(panel, /原始檔已依保存期限刪除/);
});

test("circle editor has one preview-first save path across the three responsive ranges", async () => {
  const [portal, styles, details] = await Promise.all([
    readFile(new URL("../app/circle-portal/portal-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/circle-portal/portal.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/event-workspace-panels.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(portal, /"預覽並送出"/);
  assert.match(portal, /"確認儲存"/);
  assert.match(portal, /previewOverride\(claim\.circleId, snapshot\)/);
  assert.match(portal, /saveOverride\(claim\.circleId, savingFields, reviewedRetention, reviewedThumbnailKey/);
  assert.match(portal, /Object\.hasOwn\(patch, "url"\).*setStagedThumbnailKey\(null\)/s);
  assert.equal([...portal.matchAll(/const requestGeneration = \+\+previewRequestGeneration\.current/g)].length, 2);
  assert.match(portal, /requestGeneration !== previewRequestGeneration\.current/);
  assert.doesNotMatch(portal, /initialFields\)[\s\S]{0,300}setServerPreview/, "an initial response must never replace the reviewed server projection");
  assert.doesNotMatch(portal, /saveOverride\(claim\.circleId, draft\(\)/, "a draft must never be written directly");
  assert.match(portal, /<PublicationPreview records=\{serverPreview\}/, "confirmation reuses the reader projection component");
  assert.match(portal, /groups=\{\[\]\} readOnly/, "the shared reader renderer must be explicitly non-interactive in preview");
  assert.match(details, /readOnly\?: boolean/);
  assert.doesNotMatch(styles, /previewFrame :global\(section\)[^}]*max-height/, "long review content must not be clipped");
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /@media \(min-width: 761px\) and \(max-width: 959px\)/);
  assert.match(styles, /@media \(min-width: 960px\)/);
  assert.match(styles, /position: sticky/);
  assert.match(styles, /position: fixed/);
});

test("separates the public static app from the retained editor implementation", async () => {
  const paths = ["event-map-app.tsx", "editor-page.tsx", "map-admin-importer.tsx", "map-layout-editor.tsx", "map-recognition.ts", "accessible-event-map-renderer.tsx", "static-event-map-client.ts", "event-catalog.ts", "event-workspace-panels.tsx", "planning-tools.tsx", "page.tsx", "static-circle-catalog-client.ts", "circle-records.ts", "static-circle-overrides-client.ts", "circle-editor-client.ts"];
  const [app, editorPage, admin, editor, recognizer, renderer, staticClient, eventCatalog, workspacePanels, planningTools, page, catalogClient, catalogStore, overridesClient, editorClient] = await Promise.all(paths.map((path) => readFile(new URL(`../app/${path}`, import.meta.url), "utf8")));
  const appStyles = await readFile(new URL("../app/event-map-app.module.css", import.meta.url), "utf8");
  const workspaceStyles = await readFile(new URL("../app/event-workspace-panels.module.css", import.meta.url), "utf8");
  const planningToolsStyles = await readFile(new URL("../app/planning-tools.module.css", import.meta.url), "utf8");
  const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const pagesEntry = await readFile(new URL("../main.tsx", import.meta.url), "utf8");
  const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(app, /loadStaticEventMap\(ACTIVE_EVENT_ID\)/);
  assert.match(app, /<AccessibleEventMapRenderer eventName=\{ACTIVE_EVENT\.name\} layout=\{publishedMap\.layout\}/);
  assert.match(app, /showFullDetail/);
  assert.match(app, /fullDetailsPanel/);
  assert.match(app, /導航模式/);
  assert.doesNotMatch(app, /展場模式/);
  assert.match(app, /navigationMode \? planningPanel/);
  assert.match(app, /navigationMode \? styles\.navigationWorkspace/);
  assert.match(globalStyles, /\.filters \{ padding:20px 18px;/);
  assert.match(appStyles, /\.workspace > \.leftRail \{[^}]*padding:0/);
  assert.match(app, /!navigationMode && <div className=\{styles\.planSlot\}>\{compactItineraryPanel\}<\/div>/);
  assert.doesNotMatch(app, /LAYOUT_KEY|imageDataUrl|<img\b/);
  assert.match(admin, /data-testid="map-image-input"/);
  assert.match(admin, /發布活動地圖/);
  assert.match(admin, /<MapLayoutEditor/);
  assert.match(admin, /initialMap/);
  assert.match(editor, /新增企業攤/);
  assert.match(editor, /新增舞台/);
  assert.match(editor, /選取地圖元素/);
  assert.match(editor, /縮小編輯地圖/);
  assert.match(editor, /放大編輯地圖/);
  assert.match(editor, /MAX_EDITOR_ZOOM = 4/);
  assert.match(editor, /data-resize-corner/);
  assert.match(editor, /resizeRectFromCorner/);
  assert.match(editor, /snapRectToAdjacentRects/);
  assert.match(editor, /SNAP_THRESHOLD_PX = 8/);
  assert.match(editor, /event\.altKey/);
  assert.match(editor, /className=\{styles\.snapGuide\}/);
  assert.match(editor, /非一般攤位區可拖曳四角調整大小/);
  assert.doesNotMatch(editor, /selectedLandmarkKind !== "other"/);
  assert.match(editor, /區域類型/);
  assert.match(admin, /scaleMapLandmarks/);
  assert.match(editor, /onPointerMove=\{moveDrag\}/);
  assert.match(editor, /Shift \+ 方向鍵/);
  assert.match(eventCatalog, /sampleTwoDefinition/);
  assert.match(app, /showAreaSwitcher && <fieldset/);
  assert.match(app, /data-text-scale=\{textScale\}/);
  assert.match(app, /網頁字體大小/);
  assert.match(app, /關於本頁/);
  assert.match(app, /非官方同人展逛攤工具/);
  assert.match(app, /Discord ID <strong>dekkorakki<\/strong>/);
  assert.match(app, /資料僅儲存於瀏覽器/);
  assert.match(app, /<PlanningTools \/>/);
  assert.match(page, /return <EventMapApp \/>/);
  assert.doesNotMatch(pagesEntry, /PlanningTools/);
  assert.match(planningTools, />資料管理<\/button>/);
  assert.match(planningTools, /import \{ createPortal \} from "react-dom"/);
  assert.match(planningTools, /open && createPortal\(/);
  assert.match(planningTools, /globalThis\.document\.body/);
  assert.doesNotMatch(planningToolsStyles, /\.launcher \{[^}]*position:fixed/);
  assert.match(app, /type MobileSheetLevel = "peek" \| "half" \| "full"/);
  assert.match(app, /data-mobile-sheet-level=\{mobileSheetLevel\}/);
  assert.match(app, /handleMobileSheetPointerMove/);
  assert.match(app, /mobileSheetSnapPoints\(\)\.find\(\(point\) => point\.level === mobileSheetLevel\)/);
  assert.doesNotMatch(app, /startHeight: dock\.getBoundingClientRect\(\)\.height/);
  assert.match(app, /calculatePinchMapView\(gesture\.current, distance, center, mapMinZoom\)/);
  assert.match(appStyles, /mobileDock\[data-mobile-sheet-level="peek"\]/);
  assert.match(appStyles, /mobileDock\[data-mobile-sheet-level="full"\]/);
  assert.match(appStyles, /data-mobile-sheet-level="half".*:global\(\.controls\)/s);
  assert.match(appStyles, /data-text-scale="large".*filterStack :global\(\.genres\)/s);
  assert.match(appStyles, /\.clearFiltersActive,\.filterStack \.clearFiltersActive \{ border-color:var\(--ink\); background:var\(--ink\);/);
  assert.match(appStyles, /transform:translateY\(calc\(100% - var\(--mobile-sheet-height\)\)\)/);
  assert.match(appStyles, /height:max\(0px,calc\(var\(--mobile-sheet-height\) - var\(--mobile-sheet-handle-height\) - var\(--mobile-sheet-tabs-height\) - env\(safe-area-inset-bottom\)\)\)/);
  assert.doesNotMatch(appStyles, /transition:height/);
  assert.match(app, /role="tabpanel" aria-labelledby=\{activeMobileTabId\}/);
  assert.match(app, /onFocusCapture=\{handleMobilePanelFocus\}/);
  assert.match(app, /setMobileSheetLevel\("full"\)/);
  assert.match(eventCatalog, /parseEventDefinition\(injectedDefinition, injectedReferences\)/);
  assert.match(eventCatalog, /EVENT_DEFINITION_SCHEMA = "event-definition\/3"/);
  assert.match(eventCatalog, /parseCircleCategoryCatalog\(\{/);
  assert.match(eventCatalog, /findReference\([\s\S]*"category-catalog\/1"/);
  assert.doesNotMatch(app, /MapAdminImporter|publicationNotice|showAdmin|管理活動地圖|開啟管理地圖/);
  assert.match(editorPage, /loadPublishedEventMap\(ACTIVE_EVENT_ID\)/);
  assert.match(editorPage, /<MapAdminImporter/);
  assert.doesNotMatch(app, /className=\{styles\.mapMeta\}/);
  assert.doesNotMatch(app, /publishedMap && <div className=\{styles\.layoutStatus\}/);
  assert.match(appStyles, /\.topbarActions :global\(\.help\) \{ display:block; \}/);
  assert.match(workspacePanels, /function CircleMediaGallery/);
  assert.match(workspacePanels, /record\.circle\.media/);
  assert.match(workspacePanels, /styles\.placementMeta/);
  assert.match(workspacePanels, /aria-label="圖片幻燈片控制"/);
  assert.match(workspacePanels, /<h2>當日行程列表<\/h2>/);
  assert.doesNotMatch(workspacePanels, /我的每日行程/);
  assert.match(workspacePanels, /今日購物規劃/);
  assert.match(workspacePanels, /購買項目/);
  assert.match(workspacePanels, /預算（NT\$）/);
  assert.match(workspaceStyles, /\.fullItinerary \.shoppingSummary span \{[^}]*white-space:normal/);
  assert.match(workspaceStyles, /\.fullItinerary \.purchaseEditor \{ grid-template-columns:minmax\(0,1fr\)/);
  assert.match(app, />詳細資訊<\/button>/);
  assert.doesNotMatch(app, />詳情<\/button>/);
  assert.match(workspacePanels, /更多資訊/);
  assert.match(workspacePanels, /儲存在此裝置/);
  assert.doesNotMatch(workspacePanels, /追加情報|保存在|攤位詳情|此攤位登錄/);
  assert.match(workspacePanels, /UiIcon name=\{entry\.status === "visited" \? "check-square" : "square"\}/);
  assert.doesNotMatch(workspacePanels, />\{entry\.status === "visited" \? "復原" : "走訪"\}<\/button>/);
  assert.match(workspaceStyles, /data-mobile-sheet-level="half"/);
  assert.match(workspaceStyles, /\.details \{ width:100%; min-width:0;/);
  assert.match(workspaceStyles, /\.purchaseEditor input \{ height:44px; \}/);
  assert.match(globalStyles, /html body :is\(input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\),select,textarea\) \{ font-size:16px; \}/);
  assert.doesNotMatch(workspacePanels, /heroCopy|heroMediaHint|heroWithMedia/);
  assert.match(workspaceStyles, /\.fullDetails\.detailsWithMedia \{ display:grid; grid-template-columns:/);
  assert.match(workspaceStyles, /\.fullDetails,\.fullDetails\.detailsWithMedia \{ height:auto; display:block; \}/);
  assert.match(recognizer, /slotCount !== 988/);
  assert.match(renderer, /<svg/);
  assert.match(renderer, /aria-label="場內柱子"/);
  assert.match(renderer, /aria-label="出入口"/);
  assert.match(renderer, /data-layer="selected-slots"/);
  assert.match(renderer, /row\.slots\.filter\(\(slot\) => !slots\[slot\.code\]\?\.selected\)\.map\(renderSlot\)/);
  assert.doesNotMatch(renderer, /<img\b/);
  assert.match(staticClient, /`\/data\/events\/\$\{encodeURIComponent\(eventId\)\}\/map\.json`/);
  assert.doesNotMatch(staticClient, /force-cache/);
  assert.doesNotMatch(staticClient, /\/api\/|method: "PUT"/);
  assert.match(catalogClient, /`\/data\/events\/\$\{encodeURIComponent\(eventId\)\}\/circles\.json`/);
  assert.match(catalogClient, /isCircleCatalogPayload/);
  assert.doesNotMatch(catalogClient, /\/api\/|method: "PUT"/);
  assert.match(app, /useCircleCatalog\(ACTIVE_EVENT_ID\)/);
  assert.doesNotMatch(app, /from "\.\/ff47-booths"|from "\.\/ff47-circle-templates"/);
  assert.match(catalogStore, /export function buildCircleCatalog/);
  assert.doesNotMatch(catalogStore, /ff47-booths|generated\.json/);

  // Circle-authored content is an optional anonymous supplement layered on the
  // reviewed snapshot. Its event identity and freshness behavior are covered
  // by catalog-publication and service-worker behavior tests.
  assert.match(overridesClient, /`\/data\/events\/\$\{encodeURIComponent\(eventId\)\}\/overrides\.json`/);
  assert.doesNotMatch(overridesClient, /\/api\/|method: "PUT"|credentials|Authorization/);
  assert.doesNotMatch(catalogClient, /credentials|Authorization/);

  // Base-first ordering, overlay fallback, event partitioning and retry are
  // behavior-tested through catalog-publication.test.mjs, not source regex.

  // Every authenticated write lives in one client, it always sends the session,
  // and it never touches the cacheable read namespace.
  assert.match(editorClient, /credentials: "same-origin"/);
  assert.doesNotMatch(editorClient, /\/data\/events\//);
  // An access gate answers with an HTML login page that fetch reports as a 200.
  // Parsing that must yield an actionable message, not a bare syntax error.
  assert.match(editorClient, /response\.redirected/);

  // Official identity is built first and the shared pure draft projection is
  // applied before placement view records are derived. This keeps identity and
  // placement separate while giving reader and portal one projection seam.
  assert.match(catalogStore, /const official = circleFromBase\(base, event, payload\.generatedAt\)/);
  assert.match(catalogStore, /projectCircleDraft\(official, override\.fields, override\.updatedAt\)/);
  assert.match(catalogStore, /provider: "社團本人"/);
  assert.match(catalogStore, /status: "unverified"/);
  assert.match(workspacePanels, /SOURCE_ORIGIN_LABEL/);
  assert.match(workspacePanels, /circle: "社團自述"/);
  // Structural, not substring: a D1 binding is now legitimate, but advanced
  // mode is not. A `main` entry would route every asset request — including the
  // 1.8 MB catalog — through a Worker, which is exactly what these guards exist
  // to prevent. Pages Functions under functions/ leave the static path alone.
  const wranglerConfig = JSON.parse(wrangler.replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(wranglerConfig.pages_build_output_dir, "./dist");
  assert.equal("main" in wranglerConfig, false, "Pages must never run in advanced mode");
  assert.deepEqual(
    wranglerConfig.r2_buckets.map(({ binding }) => binding),
    ["THUMBNAILS", "MAP_CONTRIBUTIONS"],
  );
  assert.deepEqual(
    wranglerConfig.env.preview.r2_buckets.map(({ binding }) => binding),
    ["THUMBNAILS", "MAP_CONTRIBUTIONS"],
    "R2 bindings are not inherited",
  );
  for (const productionBinding of wranglerConfig.r2_buckets) {
    const previewBinding = wranglerConfig.env.preview.r2_buckets.find(
      ({ binding }) => binding === productionBinding.binding,
    );
    assert.ok(previewBinding, `preview must repeat ${productionBinding.binding}`);
    assert.notEqual(productionBinding.bucket_name, previewBinding.bucket_name);
  }
  assert.equal(wranglerConfig.d1_databases.length, 1);
  assert.equal(wranglerConfig.d1_databases[0].binding, "DB");
});
