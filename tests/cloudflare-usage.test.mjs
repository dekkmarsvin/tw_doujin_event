import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildUsageReport, classifyOperations, emptyHistory, isIsoDay, parseHistory, parseR2Analytics, parseUsageLimits, renderUsageMarkdown, upsertUsageDay } from "../scripts/cloudflare-usage-core.mjs";

const classes = { classA: ["PutObject"], classB: ["GetObject"], free: ["DeleteObject"] };
const productionConfig = JSON.parse(readFileSync(new URL("../monitoring/cloudflare-usage.config.json", import.meta.url), "utf8"));
const resource = { id: "r2:production", kind: "r2", environment: "production", bucketName: "production-bucket" };
const config = { resources: [resource], operationClasses: classes };

test("monitoring covers account totals and every deployed project bucket", () => {
  assert.deepEqual(productionConfig.resources.map((entry) => entry.id), [
    "r2:account",
    "r2:production",
    "r2:preview",
    "r2:map-contributions:production",
    "r2:map-contributions:preview",
  ]);
});

function snapshot(date, payloadBytes, classA = 0, classB = 0) {
  return {
    date,
    collectedAt: `${date}T02:00:00Z`,
    resources: [{
      ...resource,
      storage: { status: "ok", measuredAt: `${date}T23:00:00Z`, objectCount: payloadBytes ? 1 : 0, uploadCount: payloadBytes ? 1 : 0, payloadBytes, metadataBytes: 0 },
      operations: { status: "ok", groups: [], totals: { all: classA + classB, classA, classB, free: 0, unknown: 0, failed: 0 } },
    }],
  };
}

test("same-day collection replaces the snapshot instead of double-counting", () => {
  let history = upsertUsageDay(emptyHistory(), snapshot("2026-08-20", 10, 2, 3));
  history = upsertUsageDay(history, snapshot("2026-08-20", 20, 5, 7));
  assert.equal(history.days.length, 1);
  assert.equal(history.days[0].resources[0].storage.payloadBytes, 20);
  assert.equal(history.days[0].resources[0].operations.totals.classA, 5);
});

test("operation classes count potentially billable failures, exempt 401, and preserve diagnostics", () => {
  const result = classifyOperations([
    { dimensions: { actionType: "PutObject", actionStatus: "success", responseStatusCode: 200 }, sum: { requests: 4 } },
    { dimensions: { actionType: "GetObject", actionStatus: "userError", responseStatusCode: 404 }, sum: { requests: 2 } },
    { dimensions: { actionType: "GetObject", actionStatus: "userError", responseStatusCode: 401 }, sum: { requests: 5 } },
    { dimensions: { actionType: "FutureAction", actionStatus: "success", responseStatusCode: 200 }, sum: { requests: 3 } },
  ], classes);
  assert.deepEqual(result.totals, { all: 14, classA: 4, classB: 2, free: 0, unknown: 3, failed: 7 });
  assert.equal(result.status, "ok");
});

test("observed read-only bucket configuration actions are conservatively Class B", () => {
  const result = classifyOperations([
    { dimensions: { actionType: "GetBucketNotificationConfiguration", actionStatus: "success", responseStatusCode: 200 }, sum: { requests: 2 } },
    { dimensions: { actionType: "GetBucketSippyConfiguration", actionStatus: "success", responseStatusCode: 200 }, sum: { requests: 3 } },
  ], productionConfig.operationClasses);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.totals, { all: 5, classA: 0, classB: 5, free: 0, unknown: 0, failed: 0 });
});

test("missing metrics are marked delayed and malformed groups expose schema drift", () => {
  const delayed = parseR2Analytics({ r2StorageAdaptiveGroups: [], r2OperationsAdaptiveGroups: [] }, resource, classes);
  assert.equal(delayed.storage.status, "delayed");
  assert.equal(delayed.operations.status, "delayed");
  const idle = parseR2Analytics({
    r2StorageAdaptiveGroups: [{ dimensions: { bucketName: resource.bucketName, datetime: "2026-08-20T23:00:00Z" }, max: { objectCount: 0, uploadCount: 0, payloadSize: 0, metadataSize: 0 } }],
    r2OperationsAdaptiveGroups: [],
  }, resource, classes);
  assert.equal(idle.storage.status, "ok");
  assert.equal(idle.operations.status, "ok");
  assert.equal(idle.operations.totals.all, 0);
  const malformed = classifyOperations([{ dimensions: { actionType: "PutObject" }, sum: { requests: "4" } }], classes);
  assert.equal(malformed.status, "schema-changed");
});

test("account analytics sums the latest storage row per bucket and every operation", () => {
  const account = parseR2Analytics({
    r2StorageAdaptiveGroups: [
      { dimensions: { bucketName: "one", datetime: "2026-08-20T22:00:00Z" }, max: { objectCount: 1, uploadCount: 1, payloadSize: 10, metadataSize: 2 } },
      { dimensions: { bucketName: "one", datetime: "2026-08-20T23:00:00Z" }, max: { objectCount: 2, uploadCount: 2, payloadSize: 20, metadataSize: 3 } },
      { dimensions: { bucketName: "two", datetime: "2026-08-20T23:30:00Z" }, max: { objectCount: 4, uploadCount: 4, payloadSize: 40, metadataSize: 5 } },
    ],
    r2OperationsAdaptiveGroups: [
      { dimensions: { bucketName: "one", actionType: "PutObject", actionStatus: "success", responseStatusCode: 200 }, sum: { requests: 3 } },
      { dimensions: { bucketName: "two", actionType: "GetObject", actionStatus: "success", responseStatusCode: 200 }, sum: { requests: 5 } },
    ],
  }, { id: "r2:account", kind: "r2", environment: "account", scope: "account" }, classes);
  assert.equal(account.storage.objectCount, 6);
  assert.equal(account.storage.payloadBytes, 60);
  assert.equal(account.operations.totals.classA, 3);
  assert.equal(account.operations.totals.classB, 5);
});

test("incomplete windows stay n/a and count only consecutive healthy snapshot days", () => {
  let history = emptyHistory();
  for (let day = 15; day <= 20; day += 1) history = upsertUsageDay(history, snapshot(`2026-08-${day}`, day * 10, 1, 2));
  const report = buildUsageReport(history, config, "2026-08-20");
  const usage = report.resources[0];
  assert.equal(report.baselineDays, 6);
  assert.equal(report.sevenDayWindowComplete, false);
  assert.equal(usage.current.storageDelta7d, null);
  assert.equal(usage.current.classA7d, null);
  assert.equal(usage.current.classB7d, null);
  assert.equal(usage.forecast.classARequestsMonth, null);
  const markdown = renderUsageMarkdown(report);
  assert.match(markdown, /7-day decision window: incomplete/);
  assert.match(markdown, /n\/a \/ n\/a \/ n\/a/);
});

test("complete daily endpoints produce exact 7 and 30 day windows", () => {
  let history = emptyHistory();
  for (let day = 1; day <= 31; day += 1) {
    history = upsertUsageDay(history, snapshot(`2026-08-${String(day).padStart(2, "0")}`, day * 10, 1, 2));
  }
  const report = buildUsageReport(history, config, "2026-08-31", { resources: { "r2:production": { storageBytes: 1_000, classARequests: 10_000 } } });
  const usage = report.resources[0];
  assert.equal(report.baselineDays, 31);
  assert.equal(report.sevenDayWindowComplete, true);
  assert.equal(report.thirtyDayWindowComplete, true);
  assert.equal(usage.current.storageDelta7d, 70);
  assert.equal(usage.current.storageDelta30d, 300);
  assert.equal(usage.current.classA7d, 7);
  assert.equal(usage.current.classA30d, 30);
  assert.equal(usage.forecast.classARequestsMonth, 31);
  assert.equal(usage.forecast.storageBytesEndOfMonth, 310);
  assert.equal(usage.limits.storageBytes, 1_000);
  assert.equal(usage.limits.classBRequests, null);
});

test("calendar dates and limits schemas fail closed", () => {
  assert.equal(isIsoDay("2026-02-28"), true);
  assert.equal(isIsoDay("2026-02-30"), false);
  assert.throws(() => parseHistory({ schema: "cloudflare-usage-history/1", days: [{ date: "2026-02-30", resources: [] }] }), /schema is invalid/);
  assert.throws(() => parseHistory({ schema: "cloudflare-usage-history/1", days: [{ date: "2026-08-21", resources: [] }] }, { latestAllowedDate: "2026-08-20" }), /disallowed date/);
  assert.throws(() => parseHistory({ schema: "cloudflare-usage-history/1", days: [{ date: "2026-08-20", resources: [] }, { date: "2026-08-20", resources: [] }] }), /duplicate dates/);

  const valid = {
    schema: "cloudflare-usage-limits/1",
    resources: { "r2:production": { storageBytes: null, classARequests: null, classBRequests: null, monthlyBudgetUsd: null } },
    pricing: { storageUsdPerGbMonth: null, classAUsdPerMillion: null, classBUsdPerMillion: null },
  };
  assert.deepEqual(parseUsageLimits(valid, config), valid);
  assert.throws(() => parseUsageLimits({ ...valid, schema: "cloudflare-usage-limits/0" }, config), /schema is invalid/);
  assert.throws(() => parseUsageLimits({ ...valid, resources: {} }, config), /must contain exactly/);
  assert.throws(() => parseUsageLimits({ ...valid, resources: { "r2:production": { ...valid.resources["r2:production"], monthlyBudgetUsd: 10 } } }, config), /not supported/);
});
