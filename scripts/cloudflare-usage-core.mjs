export const HISTORY_SCHEMA = "cloudflare-usage-history/1";

const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isoDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export function emptyHistory() {
  return { schema: HISTORY_SCHEMA, days: [] };
}

export function parseHistory(value) {
  if (!value || value.schema !== HISTORY_SCHEMA || !Array.isArray(value.days) || !value.days.every((day) => isoDay(day.date) && Array.isArray(day.resources))) {
    throw new Error("Cloudflare usage history schema is invalid.");
  }
  return value;
}

export function upsertUsageDay(history, day) {
  parseHistory(history);
  if (!isoDay(day?.date) || !Array.isArray(day.resources)) throw new Error("Cloudflare usage day is invalid.");
  return {
    schema: HISTORY_SCHEMA,
    days: [...history.days.filter((entry) => entry.date !== day.date), day].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function classifyOperations(groups, operationClasses) {
  const classes = new Map();
  for (const [name, actions] of Object.entries(operationClasses)) for (const action of actions) classes.set(action, name);
  const totals = { all: 0, classA: 0, classB: 0, free: 0, unknown: 0, failed: 0 };
  const normalized = [];
  let schemaChanged = false;
  for (const group of groups) {
    const dimensions = group?.dimensions;
    const requests = group?.sum?.requests;
    if (!dimensions || typeof dimensions.actionType !== "string" || typeof dimensions.actionStatus !== "string" || !finite(requests)) {
      schemaChanged = true;
      continue;
    }
    const item = {
      action: dimensions.actionType,
      status: dimensions.actionStatus,
      statusCode: dimensions.responseStatusCode ?? null,
      requests,
    };
    normalized.push(item);
    totals.all += requests;
    if (item.status !== "success") totals.failed += requests;
    // Cloudflare explicitly exempts unauthorized (HTTP 401) requests. Other
    // failures are still classified by action because the pricing contract does
    // not say that every failed operation is free.
    if (Number(item.statusCode) === 401) continue;
    const operationClass = classes.get(item.action);
    if (operationClass) totals[operationClass] += requests;
    else totals.unknown += requests;
  }
  return { status: schemaChanged ? "schema-changed" : "ok", groups: normalized, totals };
}

export function parseR2Analytics(account, resource, operationClasses) {
  if (!account || !Array.isArray(account.r2StorageAdaptiveGroups) || !Array.isArray(account.r2OperationsAdaptiveGroups)) {
    throw new Error("Cloudflare R2 analytics response schema changed.");
  }
  const storageRow = [...account.r2StorageAdaptiveGroups]
    .filter((row) => row?.dimensions?.bucketName === resource.bucketName)
    .sort((a, b) => String(b.dimensions.datetime).localeCompare(String(a.dimensions.datetime)))[0];
  const values = storageRow?.max;
  const storageValid = values && [values.objectCount, values.uploadCount, values.payloadSize, values.metadataSize].every(finite);
  const storage = storageValid ? {
    status: "ok",
    measuredAt: storageRow.dimensions.datetime,
    objectCount: values.objectCount,
    uploadCount: values.uploadCount,
    payloadBytes: values.payloadSize,
    metadataBytes: values.metadataSize,
  } : {
    status: storageRow ? "schema-changed" : "delayed",
    measuredAt: storageRow?.dimensions?.datetime ?? null,
    objectCount: null,
    uploadCount: null,
    payloadBytes: null,
    metadataBytes: null,
  };
  const operationRows = account.r2OperationsAdaptiveGroups.filter((row) => row?.dimensions?.bucketName === resource.bucketName);
  const operations = classifyOperations(operationRows, operationClasses);
  // A bucket with a current storage row and no operation groups had zero
  // requests. When both datasets are empty, analytics may still be delayed.
  if (operationRows.length === 0 && storage.status !== "ok") operations.status = "delayed";
  return { id: resource.id, kind: "r2", environment: resource.environment, bucketName: resource.bucketName, storage, operations };
}

function dayNumber(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function dateMinus(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

function resourceSeries(history, resourceId, throughDate) {
  return history.days.filter((day) => day.date <= throughDate).map((day) => ({ date: day.date, value: day.resources.find((resource) => resource.id === resourceId) })).filter((entry) => entry.value);
}

const add = (values) => values.filter(finite).reduce((total, value) => total + value, 0);

export function buildUsageReport(history, config, throughDate, limits = null) {
  parseHistory(history);
  if (!isoDay(throughDate)) throw new Error("Report date must be YYYY-MM-DD.");
  const monthStart = `${throughDate.slice(0, 7)}-01`;
  const daysInMonth = new Date(Date.UTC(Number(throughDate.slice(0, 4)), Number(throughDate.slice(5, 7)), 0)).getUTCDate();
  const elapsed = Number(throughDate.slice(8, 10));
  const resources = config.resources.map((resource) => {
    const series = resourceSeries(history, resource.id, throughDate);
    const currentEntry = [...series].reverse().find((entry) => entry.value.storage.status === "ok") ?? null;
    const prior = (days) => [...series].reverse().find((entry) => entry.date <= dateMinus(throughDate, days) && entry.value.storage.status === "ok") ?? null;
    const currentBytes = currentEntry?.value.storage.payloadBytes ?? null;
    const month = series.filter((entry) => entry.date >= monthStart);
    const operationDays = month.filter((entry) => entry.value.operations.status === "ok");
    const classA = add(operationDays.map((entry) => entry.value.operations.totals.classA));
    const classB = add(operationDays.map((entry) => entry.value.operations.totals.classB));
    const observedDays = new Set(operationDays.map((entry) => entry.date)).size;
    const oldest = month.find((entry) => entry.value.storage.status === "ok");
    const span = oldest && currentEntry ? Math.max(0, dayNumber(currentEntry.date) - dayNumber(oldest.date)) : 0;
    const growthPerDay = span > 0 ? (currentBytes - oldest.value.storage.payloadBytes) / span : 0;
    const projectedStorage = currentBytes === null ? null : Math.max(0, Math.round(currentBytes + growthPerDay * Math.max(0, daysInMonth - elapsed)));
    const resourceLimits = limits?.resources?.[resource.id] ?? {};
    const latest = series.at(-1)?.value;
    const status = !latest ? "missing" : latest.storage.status !== "ok" ? latest.storage.status : latest.operations.status;
    return {
      id: resource.id,
      kind: resource.kind,
      environment: resource.environment,
      status,
      current: {
        measuredAt: currentEntry?.date ?? null,
        objectCount: currentEntry?.value.storage.objectCount ?? null,
        storageBytes: currentBytes,
        storageDelta7d: currentBytes !== null && prior(7) ? currentBytes - prior(7).value.storage.payloadBytes : null,
        storageDelta30d: currentBytes !== null && prior(30) ? currentBytes - prior(30).value.storage.payloadBytes : null,
        classA7d: add(series.filter((entry) => entry.date > dateMinus(throughDate, 7)).map((entry) => entry.value.operations.totals.classA)),
        classB7d: add(series.filter((entry) => entry.date > dateMinus(throughDate, 7)).map((entry) => entry.value.operations.totals.classB)),
        classA30d: add(series.filter((entry) => entry.date > dateMinus(throughDate, 30)).map((entry) => entry.value.operations.totals.classA)),
        classB30d: add(series.filter((entry) => entry.date > dateMinus(throughDate, 30)).map((entry) => entry.value.operations.totals.classB)),
      },
      forecast: {
        storageBytesEndOfMonth: projectedStorage,
        classARequestsMonth: observedDays ? Math.round(classA / observedDays * daysInMonth) : null,
        classBRequestsMonth: observedDays ? Math.round(classB / observedDays * daysInMonth) : null,
      },
      limits: {
        storageBytes: finite(resourceLimits.storageBytes) ? resourceLimits.storageBytes : null,
        classARequests: finite(resourceLimits.classARequests) ? resourceLimits.classARequests : null,
        classBRequests: finite(resourceLimits.classBRequests) ? resourceLimits.classBRequests : null,
        monthlyBudgetUsd: finite(resourceLimits.monthlyBudgetUsd) ? resourceLimits.monthlyBudgetUsd : null,
      },
      unknownActions: [...new Set(series.flatMap((entry) => entry.value.operations.groups)
        .filter((group) => Number(group.statusCode) !== 401 && ![...config.operationClasses.classA, ...config.operationClasses.classB, ...config.operationClasses.free].includes(group.action))
        .map((group) => group.action))],
    };
  });
  return { schema: "cloudflare-usage-report/1", throughDate, observedDays: history.days.filter((day) => day.date <= throughDate).length, resources };
}

const number = (value) => value === null ? "n/a" : Number(value).toLocaleString("en-US");
const bytes = (value) => value === null ? "n/a" : `${(value / 1_048_576).toFixed(2)} MiB`;

export function renderUsageMarkdown(report) {
  const lines = [`# Cloudflare usage through ${report.throughDate}`, "", `Saved days: ${report.observedDays}`, "", "| Resource | Status | Objects | Storage | 7d delta | 30d delta | Class A 7d / 30d / EOM | Class B 7d / 30d / EOM |", "|---|---:|---:|---:|---:|---:|---:|---:|"];
  for (const resource of report.resources) {
    lines.push(`| ${resource.id} | ${resource.status} | ${number(resource.current.objectCount)} | ${bytes(resource.current.storageBytes)} | ${bytes(resource.current.storageDelta7d)} | ${bytes(resource.current.storageDelta30d)} | ${number(resource.current.classA7d)} / ${number(resource.current.classA30d)} / ${number(resource.forecast.classARequestsMonth)} | ${number(resource.current.classB7d)} / ${number(resource.current.classB30d)} / ${number(resource.forecast.classBRequestsMonth)} |`);
    if (resource.unknownActions.length) lines.push(`\nUnknown successful actions for ${resource.id}: ${resource.unknownActions.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}
