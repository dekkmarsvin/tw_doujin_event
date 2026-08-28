import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { collectEventGeneratorInput, generateEventWorkspace } from "../scripts/event-workspace-generator.mjs";
import {
  parseReferenceSelection,
  referenceSelectionPaths,
  selectEventReferenceRecords,
  verifyReferenceFiles,
} from "../scripts/reference-selection-utils.mjs";

const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  environments: { ssr: {} },
  logLevel: "silent",
});
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { parseEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
after(async () => vite.close());

const timestamp = "2026-09-01T00:00:00.000+08:00";
const venue = {
  schema: "venue/1",
  id: "existing-venue",
  name: "既有場館",
  officialUrl: "https://venue.example.invalid/existing",
  sources: [{ id: "official-page", kind: "venue-official", url: "https://venue.example.invalid/existing", retrievedAt: timestamp }],
  provenance: { "/name": ["official-page"], "/officialUrl": ["official-page"] },
};
const venueSpace = {
  schema: "venue-space/1",
  id: "existing-hall",
  venueId: "existing-venue",
  name: "既有展館",
  sources: [{ id: "official-page", kind: "venue-official", url: "https://venue.example.invalid/existing", retrievedAt: timestamp }],
  provenance: { "/name": ["official-page"] },
};

async function temporaryWorkspace(t, name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `${name}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function collectFixture(workspace) {
  const answers = [
    "fixture-next", "下一場範例活動", "11.1–2", timestamp, "2026-11-02T23:59:59.999+08:00",
    "FIXTURE_NEXT", "switchable", "manual-table/1", "https://event.example.invalid/next",
    "活動主辦公開資料與本站產生的結構化結果，可依逐檔來源說明審閱。",
    "2",
    "sat", "SAT", "11月1日", "https://event.example.invalid/next/sat",
    "sun", "SUN", "11月2日", "https://event.example.invalid/next/sun",
    "2",
    "north", "北區", "北",
    "south", "南區", "南",
    "1",
    "new-organizer", "lead", "https://organizer.example.invalid/new", "新主辦單位",
    "new-organizer", "circle-topics", "2026-09-01",
    "https://organizer.example.invalid/new/categories", "2",
    "original", "原創", "原創作品",
    "fanwork", "二次創作", "",
    "1",
    "existing-venue", "existing-hall", "north,south",
  ];
  let index = 0;
  const result = await collectEventGeneratorInput({
    workspace,
    ask: async () => {
      if (index >= answers.length) throw new Error("Wizard asked more questions than the fixture answered.");
      return answers[index++];
    },
  });
  assert.equal(index, answers.length);
  return result;
}

test("the wizard creates a complete new event from existing and new references, then reruns as a no-op", async (t) => {
  const workspace = await temporaryWorkspace(t, "event-generator-wizard");
  await writeJson(path.join(workspace, "references", "venues", "existing-venue.json"), venue);
  await writeJson(path.join(workspace, "references", "venue-spaces", "existing-hall.json"), venueSpace);
  const candidate = await collectFixture(workspace);

  const first = await generateEventWorkspace({ workspace, ...candidate, validateEventDefinition: parseEventDefinition });
  assert.equal(first.changed, true);
  assert.deepEqual(first.createdReferences.sort(), [
    "references/category-catalogs/new-organizer/circle-topics/2026-09-01.json",
    "references/organizers/new-organizer.json",
  ]);
  const event = JSON.parse(await readFile(path.join(first.eventDirectory, "event.json"), "utf8"));
  const selection = parseReferenceSelection(JSON.parse(await readFile(path.join(first.eventDirectory, "reference-selection.json"), "utf8")));
  assert.match(await readFile(path.join(first.eventDirectory, "NOTICE"), "utf8"), /Official source: https:\/\/event\.example\.invalid\/next/);
  await assert.rejects(readFile(path.join(first.eventDirectory, "official-booths.json")), /ENOENT/);
  await assert.rejects(readFile(path.join(first.eventDirectory, "map.json")), /ENOENT/);

  const bytes = new Map();
  for (const relativePath of referenceSelectionPaths(selection)) {
    bytes.set(relativePath, await readFile(path.join(workspace, ...relativePath.split("/"))));
  }
  const verified = verifyReferenceFiles(selection, bytes, event.id);
  const records = selectEventReferenceRecords(selection, verified.records, event);
  assert.equal(parseEventDefinition(event, records).id, "fixture-next");

  const before = await readFile(path.join(first.eventDirectory, "event.json"));
  const second = await generateEventWorkspace({ workspace, ...candidate, validateEventDefinition: parseEventDefinition });
  assert.deepEqual(second, { changed: false, eventDirectory: first.eventDirectory, createdReferences: [] });
  assert.deepEqual(await readFile(path.join(first.eventDirectory, "event.json")), before);

  const changed = structuredClone(candidate);
  changed.event.name = "不同名稱";
  await assert.rejects(
    generateEventWorkspace({ workspace, ...changed, validateEventDefinition: parseEventDefinition }),
    /refusing to overwrite/,
  );
  assert.equal(JSON.parse(await readFile(path.join(first.eventDirectory, "event.json"), "utf8")).name, "下一場範例活動");
});

test("validation fails before creating an event directory or reference records", async (t) => {
  const source = await temporaryWorkspace(t, "event-generator-source");
  await writeJson(path.join(source, "references", "venues", "existing-venue.json"), venue);
  await writeJson(path.join(source, "references", "venue-spaces", "existing-hall.json"), venueSpace);
  const candidate = await collectFixture(source);
  const workspace = await temporaryWorkspace(t, "event-generator-validation");
  await assert.rejects(generateEventWorkspace({
    workspace,
    ...candidate,
    validateEventDefinition: () => { throw new Error("simulated current-parser failure"); },
  }), /simulated current-parser failure/);
  await assert.rejects(readFile(path.join(workspace, "events", "fixture-next", "event.json")), /ENOENT/);
  await assert.rejects(readFile(path.join(workspace, "references", "organizers", "new-organizer.json")), /ENOENT/);
});

test("an existing reference that changes after selection is never overwritten", async (t) => {
  const workspace = await temporaryWorkspace(t, "event-generator-reference-conflict");
  const venuePath = path.join(workspace, "references", "venues", "existing-venue.json");
  await writeJson(venuePath, venue);
  await writeJson(path.join(workspace, "references", "venue-spaces", "existing-hall.json"), venueSpace);
  const candidate = await collectFixture(workspace);
  await writeJson(venuePath, { ...venue, name: "另一位維護者剛更新的名稱" });

  await assert.rejects(
    generateEventWorkspace({ workspace, ...candidate, validateEventDefinition: parseEventDefinition }),
    /existing-venue\.json already exists with different content; refusing to overwrite/,
  );
  assert.equal(JSON.parse(await readFile(venuePath, "utf8")).name, "另一位維護者剛更新的名稱");
  await assert.rejects(readFile(path.join(workspace, "events", "fixture-next", "event.json")), /ENOENT/);
});

test("a paired rename failure removes every partially installed candidate", async (t) => {
  const source = await temporaryWorkspace(t, "event-generator-rename-source");
  await writeJson(path.join(source, "references", "venues", "existing-venue.json"), venue);
  await writeJson(path.join(source, "references", "venue-spaces", "existing-hall.json"), venueSpace);
  const candidate = await collectFixture(source);
  const workspace = await temporaryWorkspace(t, "event-generator-rename");
  let installs = 0;
  const renameWithFailure = async (from, to) => {
    if (from.includes(".tmp-event-generator-") && ++installs === 2) throw new Error("simulated paired rename failure");
    return rename(from, to);
  };
  await assert.rejects(generateEventWorkspace({
    workspace,
    ...candidate,
    validateEventDefinition: parseEventDefinition,
    fileSystemOverrides: { rename: renameWithFailure },
  }), /simulated paired rename failure/);
  await assert.rejects(readFile(path.join(workspace, "events", "fixture-next", "event.json")), /ENOENT/);
  await assert.rejects(readFile(path.join(workspace, "references", "organizers", "new-organizer.json")), /ENOENT/);
  await assert.rejects(readFile(path.join(workspace, "references", "category-catalogs", "new-organizer", "circle-topics", "2026-09-01.json")), /ENOENT/);
});
