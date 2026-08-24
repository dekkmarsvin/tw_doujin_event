import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildUsageReport, emptyHistory, parseHistory, parseR2Analytics, renderUsageMarkdown, upsertUsageDay } from "./cloudflare-usage-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueAfter = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const date = valueAfter("--date") ?? yesterday;
const statePath = path.resolve(root, valueAfter("--state") ?? ".cloudflare-usage/history.json");
const summaryPath = valueAfter("--summary") ? path.resolve(root, valueAfter("--summary")) : null;
const reportOnly = args.includes("--report-only");
const allowEmptyHistory = args.includes("--allow-empty-history");
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must be YYYY-MM-DD.");

const config = JSON.parse(await readFile(path.join(root, "monitoring", "cloudflare-usage.config.json"), "utf8"));
const limits = process.env.CLOUDFLARE_USAGE_LIMITS_JSON ? JSON.parse(process.env.CLOUDFLARE_USAGE_LIMITS_JSON) : null;
let history = await readFile(statePath, "utf8").then(JSON.parse).then(parseHistory).catch((error) => {
  if (error?.code === "ENOENT" && allowEmptyHistory) return emptyHistory();
  if (error?.code === "ENOENT") {
    throw new Error(`Cloudflare usage history is missing at ${statePath}. Restore it or pass --allow-empty-history for an explicit baseline reset.`);
  }
  throw error;
});

const QUERY = `query R2Daily($accountTag: string!, $startDate: Time, $endDate: Time, $bucketName: string) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    r2StorageAdaptiveGroups(limit: 10000, filter: { datetime_geq: $startDate, datetime_leq: $endDate, bucketName: $bucketName }, orderBy: [datetime_DESC]) {
      max { objectCount uploadCount payloadSize metadataSize }
      dimensions { datetime bucketName }
    }
    r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $startDate, datetime_leq: $endDate, bucketName: $bucketName }) {
      sum { requests }
      dimensions { actionType actionStatus responseStatusCode bucketName }
    }
  } }
}`;

async function fetchResource(resource) {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: {
      accountTag: process.env.CLOUDFLARE_ACCOUNT_ID,
      startDate: `${date}T00:00:00Z`,
      endDate: `${date}T23:59:59Z`,
      bucketName: resource.bucketName,
    } }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Cloudflare GraphQL returned HTTP ${response.status}.`);
  if (!body || body.errors?.length) throw new Error(`Cloudflare GraphQL query failed: ${body?.errors?.map((error) => error.message).join("; ") ?? "invalid JSON"}`);
  const accounts = body.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) throw new Error("Cloudflare GraphQL did not return exactly one account.");
  return parseR2Analytics(accounts[0], resource, config.operationClasses);
}

let failed = false;
if (!reportOnly) {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.");
  const resources = [];
  for (const resource of config.resources) {
    try {
      resources.push(await fetchResource(resource));
    } catch (error) {
      failed = true;
      resources.push({ id: resource.id, kind: resource.kind, environment: resource.environment, bucketName: resource.bucketName, storage: { status: "error" }, operations: { status: "error", groups: [], totals: { all: 0, classA: 0, classB: 0, free: 0, unknown: 0, failed: 0 } }, error: error instanceof Error ? error.message : String(error) });
    }
  }
  history = upsertUsageDay(history, { date, collectedAt: new Date().toISOString(), resources });
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

const report = buildUsageReport(history, config, date, limits);
const markdown = renderUsageMarkdown(report);
process.stdout.write(markdown);
if (summaryPath) await writeFile(summaryPath, markdown, { encoding: "utf8", flag: "a" });
if (failed || report.resources.some((resource) => resource.status !== "ok" || resource.unknownActions.length > 0)) process.exitCode = 1;
