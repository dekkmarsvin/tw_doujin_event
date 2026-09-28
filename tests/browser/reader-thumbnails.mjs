// staged-data: fixture
//
// Replaces the source-level invariants in `tests/circle-media-degradation.test.mjs`
// with the layout a reader actually gets. ADR-0012 retired the reviewed
// thumbnail index, so a circle with a picture became the rare case: a media
// column rendered unconditionally used to be invisible and would now leave an
// empty frame beside almost every circle. That is a layout fact, and this reads
// it off the rendered grid instead of off the JSX that produces it.
//
// Pictures are only accepted over https, so the journey answers that origin
// itself — which also lets it separate "no picture" from "a picture whose bytes
// never arrived".
import assert from "node:assert/strict";
import { catalogRoute, overridesRoute, pictureRoute, PICTURE, routes, start, thumbnailOverride } from "./support/journey.mjs";
import { png } from "./support/png.mjs";

const CIRCLE = "c-900001";
const NAME = "北風畫室";
// One circle, one booth: the result list is then exactly the circle under test.
const onlyCircle = catalogRoute("sample", (data) => {
  data.placements = [{ id: "1-s01", circleId: CIRCLE, day: 1, area: "north", boothCode: "S01", status: "active", tone: "mint" }];
});
// The media column is a reader preference that is off by default, so it has to
// be asked for before there is anything to measure.
const WITH_MEDIA_COLUMN = "&media=1";

const journey = await start("reader-thumbnails");
const columns = (card) => card.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);

try {
  const scenarios = [
    { name: "picture-loads", overrides: thumbnailOverride(CIRCLE), loads: true },
    { name: "picture-fails", overrides: thumbnailOverride(CIRCLE), loads: false },
    { name: "no-picture", overrides: [], loads: true },
    { name: "portrait-sheet", overrides: [{ circleId: CIRCLE, updatedAt: "2026-01-01T00:00:00+08:00",
      fields: { catalogImages: [{ url: PICTURE, previewUrl: PICTURE, width: 300, height: 1600 }] } }], loads: true },
  ];
  const widths = {};

  for (const scenario of scenarios) {
    const page = await journey.mapPage({
      params: WITH_MEDIA_COLUMN,
      routes: routes(onlyCircle, overridesRoute("sample", scenario.overrides), scenario.loads
        ? (page) => page.route(PICTURE, route => route.fulfill({ contentType: "image/png", body: png(300, 1600) }))
        : pictureRoute(false)),
    });
    const card = page.getByRole("link", { name: new RegExp(NAME) }).first();
    await card.waitFor();
    widths[scenario.name] = await columns(card);
    assert.equal(await card.locator('[class*="resultMedia"]').count(), scenario.overrides[0]?.fields.thumbnail ? 1 : 0,
      `${scenario.name}: no empty media frame in the result card`);

    // Whatever happened to the picture, the circle is still findable and still
    // readable: that is the whole promise of degrading.
    assert.match(await card.innerText(), new RegExp(NAME), `${scenario.name}: the circle is still named`);
    assert.match(await card.innerText(), /S01/, `${scenario.name}: the booth code survives`);

    await card.click();
    const rail = page.getByRole("complementary", { name: "已選社團詳情" });
    const compactGallery = rail.getByRole("group", { name: "社團圖片", exact: true });
    assert.equal(await compactGallery.count(), scenario.overrides.length ? 1 : 0,
      `${scenario.name}: no empty gallery in the compact details`);
    if (scenario.overrides.length && scenario.loads) {
      await compactGallery.locator("img").evaluate(image => image.decode());
      const band = await compactGallery.boundingBox();
      const picture = await compactGallery.locator("img").boundingBox();
      assert.ok(picture.height <= band.height + 1 && picture.y >= band.y - 1 && picture.y + picture.height <= band.y + band.height + 1,
        "a portrait stays inside the compact gallery band");
      assert.ok(Math.abs(band.height - band.width / 2) < 2, "the portrait cannot enlarge the 16:8 band");
    }
    await page.getByRole("button", { name: "開啟完整詳細資訊", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.match(await dialog.innerText(), new RegExp(NAME), `${scenario.name}: full details still reads`);

    const gallery = await page.evaluate(() => {
      const image = document.querySelector('[role="dialog"] img');
      return image && { natural: image.naturalWidth, width: Math.round(image.getBoundingClientRect().width) };
    });
    if (scenario.overrides.length === 0) {
      // Nothing to show, so nothing is mounted — not a frame around an absence.
      assert.equal(gallery, null, "a circle with no picture gets no gallery at all");
      assert.equal(await dialog.getByRole("group", { name: "社團圖片", exact: true }).count(), 0, "no empty full gallery frame");
      const details = await dialog.getByRole("region", { name: "攤位詳細資訊", exact: true }).boundingBox();
      const body = await dialog.locator('[class*="detailBody"]').boundingBox();
      assert.ok(Math.abs(body.x + body.width / 2 - details.x - details.width / 2) < 1,
        "pictureless details occupy one centered column");
    } else {
      assert.ok(gallery, `${scenario.name}: a supplied picture is mounted`);
      assert.equal(gallery.natural > 0, scenario.loads, `${scenario.name}: the bytes arrived exactly when served`);
      const mediaBox = await dialog.getByRole("group", { name: "社團圖片", exact: true }).boundingBox();
      const body = await dialog.locator('[class*="detailBody"]').boundingBox();
      assert.ok(mediaBox.x + mediaBox.width <= body.x + 1 && body.width >= 360,
        "wide full details have separate usable media and text columns");
      if (scenario.name === "portrait-sheet") {
        const frame = dialog.locator('[class*="galleryFrame"]');
        const image = frame.locator("img");
        await image.evaluate(node => node.decode());
        const frameBox = await frame.boundingBox();
        for (const locator of [image, frame.getByRole("link", { name: /^開啟原圖/ })]) {
          const box = await locator.boundingBox();
          assert.ok(box.height <= frameBox.height + 1 && box.y + box.height <= frameBox.y + frameBox.height + 1,
            "both the portrait and its original-image link stay inside the full gallery frame");
        }
      }
    }
    await journey.capture(page, `thumbnail-${scenario.name}`);
    await page.close();
  }

  // The column is reserved for a picture and given back when there is none.
  // Both states are measured in the same run so the comparison cannot drift.
  assert.equal(widths["picture-loads"], widths["picture-fails"], "a failed picture keeps the layout it was given");
  assert.ok(widths["no-picture"] < widths["picture-loads"], `a circle with no picture drops the media column (${widths["no-picture"]} vs ${widths["picture-loads"]} columns)`);

  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
