import assert from "node:assert/strict";
import test from "node:test";
import { buildUsageReport, classifyOperations, emptyHistory, parseR2Analytics, upsertUsageDay } from "../scripts/cloudflare-usage-core.mjs";

const classes = { classA: ["PutObject"], classB: ["GetObject"], free: ["DeleteObject"] };
const resource = { id: "r2:production", kind: "r2", environment: "production", bucketName: "production-bucket" };
const config = { resources: [resource], operationClasses: classes };

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

test("7 and 30 day increments and end-of-month forecasts stay resource-scoped", () => {
  let history = emptyHistory();
  history = upsertUsageDay(history, snapshot("2026-08-01", 100, 10, 20));
  history = upsertUsageDay(history, snapshot("2026-08-10", 190, 20, 30));
  history = upsertUsageDay(history, snapshot("2026-08-20", 290, 30, 40));
  const report = buildUsageReport(history, config, "2026-08-20", { resources: { "r2:production": { storageBytes: 1_000, classARequests: 10_000 } } });
  const usage = report.resources[0];
  assert.equal(usage.current.storageDelta7d, 100);
  assert.equal(usage.current.storageDelta30d, null);
  assert.equal(usage.current.classA7d, 30);
  assert.equal(usage.current.classA30d, 60);
  assert.equal(usage.forecast.classARequestsMonth, 620);
  assert.equal(usage.forecast.storageBytesEndOfMonth, 400);
  assert.equal(usage.limits.storageBytes, 1_000);
  assert.equal(usage.limits.classBRequests, null);
});
