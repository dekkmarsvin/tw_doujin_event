import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("human contributors can find the gate, documentation authority and data-source boundary", async () => {
  const [readme, contributing, conduct, context, catalogContract] = await Promise.all([
    read("README.md"), read("CONTRIBUTING.md"), read("CODE_OF_CONDUCT.md"), read("CONTEXT.md"), read("docs/contracts/circle-catalog.md"),
  ]);
  assert.match(readme, /CONTRIBUTING\.md/);
  for (const command of ["npm test", "npm run lint", "npx tsc --noEmit --incremental false"]) assert.match(contributing, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(contributing, /主辦官網[\s\S]*社團本人/);
  assert.match(contributing, /docs\/README\.md#維護規則/);
  assert.match(contributing, /完整 commit SHA[\s\S]*SHA-256/);
  assert.match(conduct, /maintain@kotoban\.top/);
  assert.match(context, /主辦官方說明頁面[\s\S]*社團本人自填[\s\S]*不再有工作簿/);
  assert.match(catalogContract, /reviewed base[\s\S]*社團本人[\s\S]*overlay[\s\S]*不具輸入、fallback 或補充地位/);
});

test("every issue form enters the canonical triage flow", async () => {
  const forms = await Promise.all(["bug.yml", "feature.yml", "documentation.yml"]
    .map((name) => read(`.github/ISSUE_TEMPLATE/${name}`)));
  for (const form of forms) assert.match(form, /labels: \[[^\]]*"needs-triage"[^\]]*\]/);

  const contributing = await read("CONTRIBUTING.md");
  for (const label of ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"]) {
    assert.match(contributing, new RegExp("`" + label + "`"));
  }
  assert.match(await read(".github/ISSUE_TEMPLATE/config.yml"), /blank_issues_enabled: false/);
});

test("accepted reference-data and map-contribution policies stay indexed and explicit", async () => {
  const [index, referenceAdr, contributionAdr] = await Promise.all([
    read("docs/README.md"),
    read("docs/adr/0032-shared-reference-data-is-public-and-pinned.md"),
    read("docs/adr/0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md"),
  ]);
  assert.match(index, /0032-shared-reference-data-is-public-and-pinned/);
  assert.match(index, /0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts/);
  assert.match(referenceAdr, /tw_doujin_event-reference-data[\s\S]*完整 commit SHA[\s\S]*SHA-256/);
  assert.match(referenceAdr, /工作簿、社群試算表或其他第三方內容/);
  assert.match(contributionAdr, /管理者授予或撤銷[\s\S]*optimistic concurrency/);
  assert.match(contributionAdr, /20 MiB[\s\S]*PDF 最多 20 頁/);
  assert.match(contributionAdr, /180 天[\s\S]*30 天[\s\S]*90 天/);
});
