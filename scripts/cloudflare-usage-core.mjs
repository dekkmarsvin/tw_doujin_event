const HISTORY_SCHEMA = "cloudflare-usage-history/1";
const LIMITS_SCHEMA = "cloudflare-usage-limits/1";

const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
export const isIsoDay = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
}

export function parseUsageLimits(value, config) {
  if (value === null) return null;
  assertExactKeys(value, ["schema", "resources", "pricing"], "Cloudflare usage limits");
  if (value.schema !== LIMITS_SCHEMA) throw new Error("Cloudflare usage limits schema is invalid.");
  const resourceIds = config.resources.map((resource) => resource.id);
  assertExactKeys(value.resources, resourceIds, "Cloudflare usage limit resources");
  for (const id of resourceIds) {
    const limits = value.resources[id];
    assertExactKeys(limits, ["storageBytes", "classARequests", "classBRequests", "monthlyBudgetUsd"], `Cloudflare usage limits for ${id}`);
    for (const [key, limit] of Object.entries(limits)) {
      if (limit !== null && !finite(limit)) throw new Error(`Cloudflare usage limit ${id}.${key} must be null or a non-negative finite number.`);
    }
    if (limits.monthlyBudgetUsd !== null) {
      throw new Error(`Cloudflare usage limit ${id}.monthlyBudgetUsd is not supported until the notification policy is implemented.`);
    }
  }
  assertExactKeys(value.pricing, ["storageUsdPerGbMonth", "classAUsdPerMillion", "classBUsdPerMillion"], "Cloudflare usage pricing");
  for (const [key, price] of Object.entries(value.pricing)) {
    if (price !== null && !finite(price)) throw new Error(`Cloudflare usage pricing ${key} must be null or a non-negative finite number.`);
    if (price !== null) throw new Error(`Cloudflare usage pricing ${key} is not supported until invoice-cost estimation is implemented.`);
  }
  return value;
}

export function emptyHistory() {
  return { schema: HISTORY_SCHEMA, days: [] };
}

export function parseHistory(value, { latestAllowedDate = null } = {}) {
  if (!value || value.schema !== HISTORY_SCHEMA || !Array.isArray(value.days) || !value.days.every((day) => isIsoDay(day.date) && Array.isArray(day.resources))) {
    throw new Error("Cloudflare usage history schema is invalid.");
  }
  if (latestAllowedDate !== null && (!isIsoDay(latestAllowedDate) || value.days.some((day) => day.date > latestAllowedDate))) {
    throw new Error("Cloudflare usage history contains a future or otherwise disallowed date.");
  }
  if (new Set(value.days.map((day) => day.date)).size !== value.days.length) {
    throw new Error("Cloudflare usage history contains duplicate dates.");
  }
  return value;
}

export function upsertUsageDay(history, day) {
  parseHistory(history);
  if (!isIsoDay(day?.date) || !Array.isArray(day.resources)) throw new Error("Cloudflare usage day is invalid.");
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
  const accountScope = resource.scope === "account";
  let storage;
  if (accountScope) {
    const latestByBucket = new Map();
    let schemaChanged = false;
    for (const row of account.r2StorageAdaptiveGroups) {
      const bucketName = row?.dimensions?.bucketName;
      const datetime = row?.dimensions?.datetime;
      if (typeof bucketName !== "string" || typeof datetime !== "string") {
        schemaChanged = true;
        continue;
      }
      const previous = latestByBucket.get(bucketName);
      if (!previous || datetime > previous.dimensions.datetime) latestByBucket.set(bucketName, row);
    }
    const rows = [...latestByBucket.values()];
    if (rows.some((row) => !row.max || ![row.max.objectCount, row.max.uploadCount, row.max.payloadSize, row.max.metadataSize].every(finite))) {
      schemaChanged = true;
    }
    storage = rows.length > 0 && !schemaChanged ? {
      status: "ok",
      measuredAt: rows.map((row) => row.dimensions.datetime).sort().at(-1),
      objectCount: add(rows.map((row) => row.max.objectCount)),
      uploadCount: add(rows.map((row) => row.max.uploadCount)),
      payloadBytes: add(rows.map((row) => row.max.payloadSize)),
      metadataBytes: add(rows.map((row) => row.max.metadataSize)),
    } : {
      status: schemaChanged ? "schema-changed" : "delayed",
      measuredAt: null,
      objectCount: null,
      uploadCount: null,
      payloadBytes: null,
      metadataBytes: null,
    };
  } else {
    const storageRow = [...account.r2StorageAdaptiveGroups]
      .filter((row) => row?.dimensions?.bucketName === resource.bucketName)
      .sort((a, b) => String(b.dimensions.datetime).localeCompare(String(a.dimensions.datetime)))[0];
    const values = storageRow?.max;
    const storageValid = values && [values.objectCount, values.uploadCount, values.payloadSize, values.metadataSize].every(finite);
    storage = storageValid ? {
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
  }
  const operationRows = accountScope
    ? account.r2OperationsAdaptiveGroups
    : account.r2OperationsAdaptiveGroups.filter((row) => row?.dimensions?.bucketName === resource.bucketName);
  const operations = classifyOperations(operationRows, operationClasses);
  // A bucket with a current storage row and no operation groups had zero
  // requests. When both datasets are empty, analytics may still be delayed.
  if (operationRows.length === 0 && storage.status !== "ok") operations.status = "delayed";
  return { id: resource.id, kind: "r2", environment: resource.environment, scope: resource.scope ?? "bucket", bucketName: resource.bucketName ?? null, storage, operations };
}

function dayNumber(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function dateMinus(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

function resourceSeries(history, resourceId, throughDate) {
  return history.days
    .filter((day) => day.date <= throughDate)
    .map((day) => ({ date: day.date, value: day.resources.find((resource) => resource.id === resourceId) }))
    .filter((entry) => entry.value)
    .sort((a, b) => a.date.localeCompare(b.date));
}

const add = (values) => values.filter(finite).reduce((total, value) => total + value, 0);
const healthy = (entry) => entry?.value?.storage?.status === "ok"
  && entry?.value?.operations?.status === "ok"
  && entry.value.operations.totals?.unknown === 0;

function completeWindow(series, throughDate, days) {
  const byDate = new Map(series.map((entry) => [entry.date, entry]));
  const entries = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const entry = byDate.get(dateMinus(throughDate, offset));
    if (!healthy(entry)) return null;
    entries.push(entry);
  }
  return entries;
}

function consecutiveHealthyDays(series, throughDate) {
  const byDate = new Map(series.map((entry) => [entry.date, entry]));
  let days = 0;
  while (healthy(byDate.get(dateMinus(throughDate, days)))) days += 1;
  return days;
}

export function buildUsageReport(history, config, throughDate, limits = null) {
  parseHistory(history);
  if (!isIsoDay(throughDate)) throw new Error("Report date must be a real YYYY-MM-DD UTC day.");
  const monthStart = `${throughDate.slice(0, 7)}-01`;
  const daysInMonth = new Date(Date.UTC(Number(throughDate.slice(0, 4)), Number(throughDate.slice(5, 7)), 0)).getUTCDate();
  const elapsed = Number(throughDate.slice(8, 10));
  const resources = config.resources.map((resource) => {
    const series = resourceSeries(history, resource.id, throughDate);
    const currentEntry = [...series].reverse().find((entry) => entry.value.storage.status === "ok") ?? null;
    const currentBytes = currentEntry?.value.storage.payloadBytes ?? null;
    const month = series.filter((entry) => entry.date >= monthStart);
    const operationDays = month.filter(healthy);
    const classA = add(operationDays.map((entry) => entry.value.operations.totals.classA));
    const classB = add(operationDays.map((entry) => entry.value.operations.totals.classB));
    const observedDays = new Set(operationDays.map((entry) => entry.date)).size;
    const baselineDays = consecutiveHealthyDays(series, throughDate);
    const oldest = operationDays[0] ?? null;
    const span = oldest && currentEntry ? Math.max(0, dayNumber(currentEntry.date) - dayNumber(oldest.date)) : 0;
    const growthPerDay = span > 0 ? (currentBytes - oldest.value.storage.payloadBytes) / span : 0;
    const forecastReady = baselineDays >= 7;
    const projectedStorage = currentBytes === null || !forecastReady ? null : Math.max(0, Math.round(currentBytes + growthPerDay * Math.max(0, daysInMonth - elapsed)));
    const resourceLimits = limits?.resources?.[resource.id] ?? {};
    const latest = series.at(-1)?.value;
    const status = !latest ? "missing" : latest.storage.status !== "ok" ? latest.storage.status : latest.operations.status;
    const storageWindow = (days) => completeWindow(series, throughDate, days + 1);
    const operationWindow = (days) => completeWindow(series, throughDate, days);
    const storageDelta = (days) => {
      const window = storageWindow(days);
      return window ? window.at(-1).value.storage.payloadBytes - window[0].value.storage.payloadBytes : null;
    };
    const operationTotal = (days, key) => {
      const window = operationWindow(days);
      return window ? add(window.map((entry) => entry.value.operations.totals[key])) : null;
    };
    return {
      id: resource.id,
      kind: resource.kind,
      environment: resource.environment,
      scope: resource.scope ?? "bucket",
      bucketName: resource.bucketName ?? null,
      status,
      baseline: {
        consecutiveHealthyDays: baselineDays,
        sevenDayWindowComplete: Boolean(completeWindow(series, throughDate, 8)),
        thirtyDayWindowComplete: Boolean(completeWindow(series, throughDate, 31)),
      },
      current: {
        measuredAt: currentEntry?.date ?? null,
        objectCount: currentEntry?.value.storage.objectCount ?? null,
        storageBytes: currentBytes,
        storageDelta7d: storageDelta(7),
        storageDelta30d: storageDelta(30),
        classA7d: operationTotal(7, "classA"),
        classB7d: operationTotal(7, "classB"),
        classA30d: operationTotal(30, "classA"),
        classB30d: operationTotal(30, "classB"),
      },
      forecast: {
        storageBytesEndOfMonth: projectedStorage,
        classARequestsMonth: forecastReady && observedDays ? Math.round(classA / observedDays * daysInMonth) : null,
        classBRequestsMonth: forecastReady && observedDays ? Math.round(classB / observedDays * daysInMonth) : null,
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
  return {
    schema: "cloudflare-usage-report/1",
    throughDate,
    observedDays: history.days.filter((day) => day.date <= throughDate).length,
    baselineDays: resources.length ? Math.min(...resources.map((resource) => resource.baseline.consecutiveHealthyDays)) : 0,
    sevenDayWindowComplete: resources.length > 0 && resources.every((resource) => resource.baseline.sevenDayWindowComplete),
    thirtyDayWindowComplete: resources.length > 0 && resources.every((resource) => resource.baseline.thirtyDayWindowComplete),
    resources,
  };
}

const number = (value) => value === null ? "n/a" : Number(value).toLocaleString("en-US");
const bytes = (value) => value === null ? "n/a" : `${(value / 1_048_576).toFixed(2)} MiB`;

export function renderUsageMarkdown(report) {
  const lines = [`# Cloudflare usage through ${report.throughDate}`, "", `Saved days: ${report.observedDays}`, `Complete baseline: ${report.baselineDays} consecutive healthy UTC snapshot days across all monitored resources`, `7-day decision window: ${report.sevenDayWindowComplete ? "complete" : "incomplete"}`, "", "| Resource | Status | Healthy days | Objects | Storage | 7d delta | 30d delta | Class A 7d / 30d / EOM | Class B 7d / 30d / EOM |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|"];
  for (const resource of report.resources) {
    const name = resource.scope === "account" ? `${resource.id} (all account buckets)` : `${resource.id} (${resource.bucketName})`;
    lines.push(`| ${name} | ${resource.status} | ${resource.baseline.consecutiveHealthyDays} | ${number(resource.current.objectCount)} | ${bytes(resource.current.storageBytes)} | ${bytes(resource.current.storageDelta7d)} | ${bytes(resource.current.storageDelta30d)} | ${number(resource.current.classA7d)} / ${number(resource.current.classA30d)} / ${number(resource.forecast.classARequestsMonth)} | ${number(resource.current.classB7d)} / ${number(resource.current.classB30d)} / ${number(resource.forecast.classBRequestsMonth)} |`);
    if (resource.unknownActions.length) lines.push(`\nUnknown successful actions for ${resource.id}: ${resource.unknownActions.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}
