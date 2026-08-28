import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createServer, isRunnableDevEnvironment } from "vite";
import {
  mergeOfficialBoothImports,
  parseOfficialBoothImportTable,
  prepareOfficialBoothImport,
  writeOfficialBoothCandidate,
} from "./official-booth-importer.mjs";
import {
  parseReferenceSelection,
  referenceSelectionPaths,
  selectEventReferenceRecords,
  verifyReferenceFiles,
} from "./reference-selection-utils.mjs";
import { readJsonFileStrict } from "./strict-json-file.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let workspaceArgument = null;
let eventId = null;
const arguments_ = process.argv.slice(2);
for (let index = 0; index < arguments_.length; index += 1) {
  if (arguments_[index] === "--workspace" && !workspaceArgument && arguments_[index + 1]) {
    workspaceArgument = arguments_[++index];
  } else if (arguments_[index] === "--event" && !eventId && arguments_[index + 1]) {
    eventId = arguments_[++index];
  } else throw new Error("Usage: npm run booths:import -- --workspace <data-repo-checkout> --event <event-id>");
}
if (!workspaceArgument || !eventId || !/^[a-z0-9][a-z0-9-]*$/u.test(eventId)) {
  throw new Error("Usage: npm run booths:import -- --workspace <data-repo-checkout> --event <event-id>");
}
const workspace = path.resolve(workspaceArgument);
const eventDirectory = path.join(workspace, "events", eventId);

async function loadValidatedEvent(vite) {
  const event = await readJsonFileStrict(path.join(eventDirectory, "event.json"), "event.json");
  if (event.id !== eventId) throw new Error(`Event identity mismatch: expected ${eventId}, got ${event.id}.`);
  const selection = parseReferenceSelection(
    await readJsonFileStrict(path.join(eventDirectory, "reference-selection.json"), "reference-selection.json"),
  );
  const files = new Map(await Promise.all(referenceSelectionPaths(selection).map(async (relativePath) => [
    relativePath,
    await readFile(path.join(workspace, ...relativePath.split("/"))),
  ])));
  const verified = verifyReferenceFiles(selection, files, eventId);
  const records = selectEventReferenceRecords(selection, verified.records, event);
  const environment = vite.environments.ssr;
  if (!isRunnableDevEnvironment(environment)) throw new Error("The current event validator is unavailable.");
  const { parseEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
  return parseEventDefinition(event, records);
}

function compact(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

async function required(readline, question) {
  const value = compact(await readline.question(`${question}: `));
  if (!value) throw new Error(`${question} is required.`);
  return value;
}

async function positiveInteger(readline, question, fallback = null) {
  const answer = compact(await readline.question(`${question}${fallback === null ? "" : `（預設 ${fallback}）`}: `));
  const value = Number(answer || fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${question} must be a positive integer.`);
  return value;
}

async function pastedInput(readline) {
  return new Promise((resolve, reject) => {
    const lines = [];
    const onClose = () => {
      cleanup();
      reject(new Error("Input closed before the pasted table ended with .end."));
    };
    const onLine = (line) => {
      if (line !== ".end") {
        lines.push(line);
        return;
      }
      cleanup();
      resolve(lines.join("\n"));
    };
    function cleanup() {
      readline.off("line", onLine);
      readline.off("close", onClose);
    }
    readline.on("line", onLine);
    readline.on("close", onClose);
    console.log("貼上官方表格內容；完成後在新的一行輸入 .end");
  });
}

async function selectColumn(readline, label, header) {
  const selected = await positiveInteger(readline, `${label}欄位編號`);
  if (selected > header.length) throw new Error(`${label}欄位編號超出表頭範圍。`);
  return selected - 1;
}

function printErrors(batch, errors) {
  for (const error of errors) {
    console.error(`批次 ${batch}${error.row === null ? "" : `／來源列 ${error.row}`} [${error.code}] ${error.message}`);
  }
}

const readline = createInterface({ input: process.stdin, output: process.stdout });
const vite = await createServer({
  configFile: false,
  root,
  server: { middlewareMode: true },
  appType: "custom",
  environments: { ssr: {} },
  logLevel: "silent",
});
try {
  const event = await loadValidatedEvent(vite);
  console.log(`匯入活動：${event.name} (${event.id})`);
  console.log(`活動 days／periods：${event.days.map(({ id, label }) => `${id}=${label}`).join("、")}`);
  const batchCount = await positiveInteger(readline, "要匯入的表格數量", 1);
  const previews = [];
  let hasErrors = false;
  for (let batch = 1; batch <= batchCount; batch += 1) {
    console.log(`\n批次 ${batch}/${batchCount}`);
    const format = (await required(readline, "格式（csv/tsv/html）")).toLowerCase();
    const inputPath = compact(await readline.question("來源檔案路徑（留空可直接貼上）: "));
    const input = inputPath ? await readFile(path.resolve(inputPath), "utf8") : await pastedInput(readline);
    const table = parseOfficialBoothImportTable(input, format);
    const headerRow = await positiveInteger(readline, "表頭列", 1);
    if (headerRow > table.rows.length) throw new Error("表頭列超出輸入範圍。");
    const header = table.rows[headerRow - 1].cells.map(compact);
    console.log(header.map((name, index) => `${index + 1}:${name || "（空白）"}`).join(" | "));
    const boothColumn = await selectColumn(readline, "booth code", header);
    const circleColumn = await selectColumn(readline, "circle name", header);
    const boothCodeMode = (await required(readline, "booth code 解析模式（single/delimited/fixed-width）")).toLowerCase();
    const boothCodeWidth = boothCodeMode === "fixed-width"
      ? await positiveInteger(readline, "每個 booth code 的字元寬度")
      : undefined;
    const dayAnswer = compact(await readline.question("day／period 欄位編號（若整張表屬同一天則留空）: "));
    let dayColumn;
    let fixedDay;
    const dayValues = {};
    if (dayAnswer) {
      const selected = Number(dayAnswer);
      if (!Number.isInteger(selected) || selected < 1 || selected > header.length) throw new Error("day／period 欄位編號超出表頭範圍。");
      dayColumn = selected - 1;
      const rawValues = [...new Set(table.rows.slice(headerRow).map((row) => compact(row.cells[dayColumn])).filter(Boolean))];
      for (const raw of rawValues) dayValues[raw] = await required(readline, `來源值「${raw}」對映到 event day／period ID`);
    } else {
      fixedDay = await required(readline, "這張表對映到 event day／period ID");
    }
    const preview = prepareOfficialBoothImport({
      table,
      event,
      headerRow,
      mapping: { boothColumn, circleColumn, boothCodeMode, boothCodeWidth, dayColumn, fixedDay, dayValues },
      requireEveryDay: false,
    });
    previews.push(preview);
    if (preview.errors.length > 0) {
      hasErrors = true;
      printErrors(batch, preview.errors);
    } else console.log(`批次 ${batch} 預覽：${preview.importedRows} 個社團列、${preview.boothCount} 個 booth code。`);
  }
  if (hasErrors) throw new Error("匯入預覽有錯誤；未寫入 official-booths.json。");
  const merged = mergeOfficialBoothImports(previews, event);
  if (merged.errors.length > 0) {
    printErrors("合併", merged.errors);
    throw new Error("匯入合併有錯誤；未寫入 official-booths.json。");
  }
  console.log(`\n最終預覽：${merged.importedRows} 個社團列、${merged.boothCount} 個 booth code。`);
  console.log(JSON.stringify(merged.payload, null, 2));
  const confirmation = await readline.question("\n確認寫入發布候選請輸入 WRITE；其他輸入會取消: ");
  if (confirmation !== "WRITE") {
    console.log("已取消；未寫入 official-booths.json。");
  } else {
    const result = await writeOfficialBoothCandidate({
      workspace,
      eventId,
      payload: merged.payload,
      event,
      confirmed: true,
    });
    console.log(result.changed
      ? `已寫入 ${path.relative(workspace, result.destination)}；請 review data repo diff。`
      : `${path.relative(workspace, result.destination)} 已與預覽相同，沒有變更。`);
  }
} finally {
  readline.close();
  await vite.close();
}
