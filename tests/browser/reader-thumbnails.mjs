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
import { catalogRoute, overridesRoute, pictureRoute, routes, start, thumbnailOverride } from "./support/journey.mjs";

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
  ];
  const widths = {};

  for (const scenario of scenarios) {
    const page = await journey.mapPage({
      params: WITH_MEDIA_COLUMN,
      routes: routes(onlyCircle, overridesRoute("sample", scenario.overrides), pictureRoute(scenario.loads)),
    });
    const card = page.getByRole("link", { name: new RegExp(NAME) }).first();
    await card.waitFor();
    widths[scenario.name] = await columns(card);

    // Whatever happened to the picture, the circle is still findable and still
    // readable: that is the whole promise of degrading.
    assert.match(await card.innerText(), new RegExp(NAME), `${scenario.name}: the circle is still named`);
    assert.match(await card.innerText(), /S01/, `${scenario.name}: the booth code survives`);

    await card.click();
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
    } else {
      assert.ok(gallery, `${scenario.name}: a supplied picture is mounted`);
      assert.equal(gallery.natural > 0, scenario.loads, `${scenario.name}: the bytes arrived exactly when served`);
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
