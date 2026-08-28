import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  mergeOfficialBoothImports,
  parseOfficialBoothData,
  parseOfficialBoothImportTable,
  prepareOfficialBoothImport,
  writeOfficialBoothCandidate,
} from "../scripts/official-booth-importer.mjs";

const event = {
  id: "fixture-next",
  days: [
    { id: "sat", label: "SAT", dateLabel: "11月1日" },
    { id: "sun", label: "SUN", dateLabel: "11月2日" },
  ],
  officialData: {
    boothListUrls: {
      sat: "https://event.example.invalid/next/sat",
      sun: "https://event.example.invalid/next/sun",
    },
  },
};

async function temporaryWorkspace(t) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "official-booth-import-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(path.join(workspace, "events", event.id), { recursive: true });
  return workspace;
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

test("CSV columns are explicitly mapped and quoted cells produce the existing official booth schema", () => {
  const table = parseOfficialBoothImportTable([
    "社團名稱,日期,攤位",
    '"Comma, Circle",第一天,"A01、A02"',
    "另一社團,第二天,B03",
  ].join("\r\n"), "csv");
  const preview = prepareOfficialBoothImport({
    table,
    event,
    mapping: {
      circleColumn: 0,
      dayColumn: 1,
      boothColumn: 2,
      boothCodeMode: "delimited",
      dayValues: { 第一天: "sat", 第二天: "sun" },
    },
  });

  assert.deepEqual(preview.errors, []);
  assert.equal(preview.importedRows, 2);
  assert.equal(preview.boothCount, 3);
  assert.deepEqual(preview.candidates, [
    { day: "sat", codes: ["A01", "A02"], name: "Comma, Circle", sourceRow: 2 },
    { day: "sun", codes: ["B03"], name: "另一社團", sourceRow: 3 },
  ]);
  assert.deepEqual(preview.payload, {
    schemaVersion: 1,
    days: [
      {
        day: "sat",
        url: "https://event.example.invalid/next/sat",
        booths: [{ codes: ["A01", "A02"], name: "Comma, Circle" }],
      },
      {
        day: "sun",
        url: "https://event.example.invalid/next/sun",
        booths: [{ codes: ["B03"], name: "另一社團" }],
      },
    ],
  });
  assert.equal(parseOfficialBoothData(preview.payload, event), preview.payload);
  const placementCollision = structuredClone(preview.payload);
  placementCollision.days[0].booths.push({ codes: ["a01"], name: "大小寫衝突" });
  assert.throws(() => parseOfficialBoothData(placementCollision, event), /duplicate placement ID/);
});

test("TSV import reports missing, duplicate, and unmapped rows without producing a candidate", () => {
  const table = parseOfficialBoothImportTable([
    "period\tspace\tname",
    "D1\tA01\t社團甲",
    "D1\ta01\t社團乙",
    "D2\t\t社團丙",
    "unknown\tC01\t社團丁",
  ].join("\n"), "tsv");
  const preview = prepareOfficialBoothImport({
    table,
    event,
    mapping: { dayColumn: 0, boothColumn: 1, circleColumn: 2, boothCodeMode: "delimited", dayValues: { D1: "sat", D2: "sun" } },
  });

  assert.equal(preview.payload, null);
  assert.deepEqual(preview.errors.map(({ row, code }) => [row, code]), [
    [3, "duplicate_booth"],
    [4, "missing_booth"],
    [5, "unmapped_day"],
    [null, "missing_day"],
  ]);
});

test("separate pasted tables can map a fixed day and merge into one event candidate", () => {
  const table = parseOfficialBoothImportTable(`
    <table>
      <tr><th>區域</th><th>攤位</th><th>社團</th></tr>
      <tr><td rowspan="2">北區</td><td>A01A02</td><td>甲&middot;乙&amp;丙</td></tr>
      <tr><td>A03</td><td>丙</td></tr>
    </table>
  `, "html");
  assert.deepEqual(table.rows.map((row) => row.line), [3, 4, 5]);
  assert.deepEqual(table.rows[2].cells, ["北區", "A03", "丙"]);
  const preview = prepareOfficialBoothImport({
    table,
    event,
    mapping: { fixedDay: "sat", boothColumn: 1, circleColumn: 2, boothCodeMode: "fixed-width", boothCodeWidth: 3 },
    requireEveryDay: false,
  });
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.payload.days[0].booths, [
    { codes: ["A01", "A02"], name: "甲·乙&丙" },
    { codes: ["A03"], name: "丙" },
  ]);
  const second = prepareOfficialBoothImport({
    table: parseOfficialBoothImportTable("booth\tcircle\nB01\t丁", "tsv"),
    event,
    mapping: { fixedDay: "sun", boothColumn: 0, circleColumn: 1, boothCodeMode: "single" },
    requireEveryDay: false,
  });
  const merged = mergeOfficialBoothImports([preview, second], event);
  assert.deepEqual(merged.errors, []);
  assert.equal(merged.importedRows, 3);
  assert.equal(merged.boothCount, 4);
  assert.deepEqual(merged.payload.days[1].booths, [{ codes: ["B01"], name: "丁" }]);

  const ambiguous = prepareOfficialBoothImport({
    table: parseOfficialBoothImportTable("booth,circle\nA01A02X,戊", "csv"),
    event,
    mapping: { fixedDay: "sat", boothColumn: 0, circleColumn: 1, boothCodeMode: "fixed-width", boothCodeWidth: 3 },
    requireEveryDay: false,
  });
  assert.deepEqual(ambiguous.errors.map(({ row, code }) => [row, code]), [[2, "unparseable_booth"]]);
  assert.equal(ambiguous.payload, null);
});

test("nothing is written before confirmation; confirmed writes are atomic and exact reruns are no-ops", async (t) => {
  const workspace = await temporaryWorkspace(t);
  const table = parseOfficialBoothImportTable("day,booth,circle\n1,A01,甲\n2,B01,乙", "csv");
  const preview = prepareOfficialBoothImport({
    table,
    event,
    mapping: { dayColumn: 0, boothColumn: 1, circleColumn: 2, boothCodeMode: "single", dayValues: { 1: "sat", 2: "sun" } },
  });
  const destination = path.join(workspace, "events", event.id, "official-booths.json");

  await assert.rejects(
    writeOfficialBoothCandidate({ workspace, eventId: event.id, payload: preview.payload, event, confirmed: false }),
    /not confirmed/,
  );
  await assert.rejects(readFile(destination), /ENOENT/);

  const first = await writeOfficialBoothCandidate({ workspace, eventId: event.id, payload: preview.payload, event, confirmed: true });
  assert.equal(first.changed, true);
  assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), preview.payload);
  const second = await writeOfficialBoothCandidate({ workspace, eventId: event.id, payload: preview.payload, event, confirmed: true });
  assert.equal(second.changed, false);

  await writeFile(destination, '{"previous":true}\n');
  let renameCount = 0;
  await assert.rejects(writeOfficialBoothCandidate({
    workspace,
    eventId: event.id,
    payload: preview.payload,
    event,
    confirmed: true,
    fileSystemOverrides: {
      rename: async (from, to) => {
        renameCount += 1;
        if (renameCount === 2) throw new Error("simulated candidate install failure");
        return rename(from, to);
      },
    },
  }), /simulated candidate install failure/);
  assert.equal(await readFile(destination, "utf8"), '{"previous":true}\n');
});

test("the interactive CLI accepts pasted CSV, previews it, and writes only after WRITE", async (t) => {
  const workspace = await temporaryWorkspace(t);
  const fixtureEvent = JSON.parse(await readFile(path.join("fixtures", "events", "sample", "event.json"), "utf8"));
  const records = JSON.parse(await readFile(path.join("fixtures", "events", "sample", "reference-records.json"), "utf8"));
  const paths = [
    "references/organizers/sample-organizer.json",
    "references/category-catalogs/sample-organizer/circle-topics/2026-01-01.json",
    "references/venues/sample-venue.json",
    "references/venue-spaces/sample-hall.json",
  ];
  await writeJson(path.join(workspace, "events", "sample", "event.json"), fixtureEvent);
  await Promise.all(paths.map((relativePath, index) => writeJson(path.join(workspace, ...relativePath.split("/")), records[index])));
  await writeJson(path.join(workspace, "events", "sample", "reference-selection.json"), {
    schema: "reference-selection/1",
    eventId: "sample",
    organizers: [{ id: "sample-organizer", path: paths[0] }],
    categoryCatalog: {
      id: "circle-topics", organizerId: "sample-organizer", revision: "2026-01-01", path: paths[1],
    },
    venues: [{ id: "sample-venue", path: paths[2], spaces: [{ id: "sample-hall", path: paths[3] }] }],
  });

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(process.cwd(), "scripts", "import-official-booths.mjs"),
      "--workspace", workspace, "--event", "sample",
    ], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const exchanges = [
      ["要匯入的表格數量", "\n"],
      ["格式（csv/tsv/html）", "csv\n"],
      ["來源檔案路徑", "\n"],
      ["貼上官方表格內容", "day,booth,circle\nD1,A01,甲\nD2,B01,乙\n.end\n"],
      ["表頭列", "\n"],
      ["booth code欄位編號", "2\n"],
      ["circle name欄位編號", "3\n"],
      ["booth code 解析模式", "single\n"],
      ["day／period 欄位編號", "1\n"],
      ["來源值「D1」", "1\n"],
      ["來源值「D2」", "2\n"],
      ["確認寫入發布候選", "WRITE\n"],
    ];
    let exchange = 0;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (exchange < exchanges.length && stdout.includes(exchanges[exchange][0])) {
        child.stdin.write(exchanges[exchange][1]);
        exchange += 1;
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      child.stdin.destroy();
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`CLI exited ${code}: ${stderr}`));
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out after prompt ${exchange}: ${stdout}\n${stderr}`));
    }, 10_000);
    child.on("exit", () => clearTimeout(timeout));
  });
  assert.match(result.stdout, /最終預覽：2 個社團列、2 個 booth code/);
  assert.match(result.stdout, /請 review data repo diff/);
  assert.equal(result.stderr, "");
  const output = JSON.parse(await readFile(path.join(workspace, "events", "sample", "official-booths.json"), "utf8"));
  assert.deepEqual(output.days.map(({ day, booths }) => [day, booths[0].codes[0]]), [[1, "A01"], [2, "B01"]]);
});
