import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("human contributors can find the gate, documentation authority and data-source boundary", async () => {
  const [readme, contributing, conduct] = await Promise.all([
    read("README.md"), read("CONTRIBUTING.md"), read("CODE_OF_CONDUCT.md"),
  ]);
  assert.match(readme, /CONTRIBUTING\.md/);
  for (const command of ["npm test", "npm run lint", "npx tsc --noEmit --incremental false"]) assert.match(contributing, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(contributing, /主辦官網[\s\S]*社團本人/);
  assert.match(contributing, /docs\/README\.md#維護規則/);
  assert.match(contributing, /完整 commit SHA[\s\S]*SHA-256/);
  assert.match(conduct, /maintain@kotoban\.top/);
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
