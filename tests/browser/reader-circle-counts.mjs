// staged-data: fixture
// A circle with two booths remains two selectable results but counts once.
import assert from "node:assert/strict";
import { catalogRoute, start } from "./support/journey.mjs";

const catalog = catalogRoute("sample", (data) => {
  // A second identity with the same name must still count separately.
  data.circles[1].name = data.circles[0].name;
  data.placements.push({ ...data.placements[1], id: "1-s02-shared", circleId: data.circles[0].id });
});

const journey = await start("reader-circle-counts");
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const mobile = viewport.width < 761;
    const page = await journey.mapPage({ viewport, routes: catalog });
    if (mobile) await page.getByRole("button", { name: "探索", exact: true }).click();
    const results = page.getByRole("region", { name: "搜尋結果", exact: true });
    await results.getByText("2 個社團 · 3 筆結果", { exact: true }).waitFor();
    assert.equal(await results.locator("article").count(), 3, "each placement remains selectable");
    await journey.capture(page, `circle-counts-${viewport.width}`);

    if (mobile) await page.getByRole("button", { name: "篩選攤位", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: /^全部類別/ }).locator("small").innerText(), "2", "uncategorized circles are counted once");
    if (mobile) await page.getByRole("button", { name: "回結果", exact: true }).click();

    const search = page.getByRole("textbox", { name: "搜尋社團、攤位或作品", exact: true });
    await search.fill("S01");
    // A unique search opens the booth summary on mobile; return to its results.
    if (mobile) await page.getByRole("button", { name: "回結果", exact: true }).click();
    await results.getByText("1 個社團 · 1 筆結果", { exact: true }).waitFor();
    await search.fill("S02");
    await results.getByText("2 個社團 · 2 筆結果", { exact: true }).waitFor();
    await search.fill("no-such-circle");
    await results.getByText("0 個社團 · 0 筆結果", { exact: true }).waitFor();
    await search.fill("");
    await results.getByText("2 個社團 · 3 筆結果", { exact: true }).waitFor();
    await journey.capture(page, `circle-counts-search-restored-${viewport.width}`);
    await page.close();
  }
  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
