import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  REFERENCE_SELECTION_SCHEMA,
  parseReferenceSelection,
  referenceSelectionPaths,
  selectEventReferenceRecords,
  verifyReferenceFiles,
} from "./reference-selection-utils.mjs";
import { replaceVerifiedTrees } from "./verified-tree-replace.mjs";

const EVENT_DEFINITION_SCHEMA = "event-definition/3";

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readIfExists(target) {
  try {
    return await readFile(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function statIfExists(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function requireReferenceMap(references) {
  if (!(references instanceof Map)) throw new Error("Generator references must be a Map keyed by selected path.");
  return references;
}

function normalizeNotice(notice) {
  if (typeof notice !== "string" || notice.trim() === "") throw new Error("Event NOTICE must not be empty.");
  return `${notice.trim()}\n`;
}

function assertSameJson(existing, expected, label) {
  const actual = parseJson(existing, label);
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`${label} already exists with different content; refusing to overwrite it.`);
}

async function assertExistingEventIsNoop(eventDirectory, candidates) {
  const stat = await statIfExists(eventDirectory);
  if (!stat) return false;
  if (!stat.isDirectory()) throw new Error(`${eventDirectory} exists and is not a directory.`);
  for (const [name, expected] of candidates) {
    const existing = await readIfExists(path.join(eventDirectory, name));
    if (!existing || !existing.equals(expected)) {
      throw new Error(`${path.join(eventDirectory, name)} already exists with different or incomplete content; refusing to overwrite it.`);
    }
  }
  return true;
}

/**
 * Validate every candidate with the main repository's existing seams, then
 * install the event directory and any missing reference records as one paired
 * replacement. Existing content is never rewritten: an exact rerun is a no-op
 * and any difference fails closed.
 */
export async function generateEventWorkspace({
  workspace,
  event,
  selection,
  references,
  notice,
  validateEventDefinition,
  fileSystemOverrides = {},
}) {
  if (typeof workspace !== "string" || workspace.trim() === "") throw new Error("A data workspace path is required.");
  if (typeof validateEventDefinition !== "function") throw new Error("The current event definition validator is required.");
  const root = path.resolve(workspace);
  const parsedSelection = parseReferenceSelection(selection);
  if (event?.schema !== EVENT_DEFINITION_SCHEMA) throw new Error("Generator event uses an unsupported schema.");
  if (event.id !== parsedSelection.eventId) throw new Error(`Generator event identity mismatch: ${event.id} versus ${parsedSelection.eventId}.`);

  const suppliedReferences = requireReferenceMap(references);
  const referenceBytes = new Map();
  const missingReferences = [];
  for (const relativePath of referenceSelectionPaths(parsedSelection)) {
    const expected = suppliedReferences.get(relativePath);
    if (!expected) throw new Error(`Generator is missing selected reference ${relativePath}.`);
    const destination = path.join(root, ...relativePath.split("/"));
    const existing = await readIfExists(destination);
    if (existing) {
      assertSameJson(existing, expected, destination);
      referenceBytes.set(relativePath, existing);
    } else {
      const serialized = Buffer.from(serializeJson(expected));
      referenceBytes.set(relativePath, serialized);
      missingReferences.push({ relativePath, destination, serialized });
    }
  }
  for (const relativePath of suppliedReferences.keys()) {
    if (!referenceBytes.has(relativePath)) throw new Error(`Generator received unselected reference ${relativePath}.`);
  }

  const verified = verifyReferenceFiles(parsedSelection, referenceBytes, event.id);
  const selectedRecords = selectEventReferenceRecords(parsedSelection, verified.records, event);
  validateEventDefinition(event, selectedRecords);

  const eventDirectory = path.join(root, "events", event.id);
  const candidates = new Map([
    ["event.json", Buffer.from(serializeJson(event))],
    ["reference-selection.json", Buffer.from(serializeJson(parsedSelection))],
    ["NOTICE", Buffer.from(normalizeNotice(notice))],
  ]);
  const eventExists = await assertExistingEventIsNoop(eventDirectory, candidates);
  if (eventExists) {
    if (missingReferences.length > 0) {
      throw new Error(`Event ${event.id} already exists while selected references are missing; refusing a partial repair.`);
    }
    return { changed: false, eventDirectory, createdReferences: [] };
  }

  const temporaryRoot = await mkdtemp(path.join(root, ".tmp-event-generator-"));
  try {
    const temporaryEvent = path.join(temporaryRoot, "event");
    await mkdir(temporaryEvent);
    for (const [name, bytes] of candidates) await writeFile(path.join(temporaryEvent, name), bytes);

    const replacements = [];
    for (const reference of missingReferences) {
      const temporary = path.join(temporaryRoot, ...reference.relativePath.split("/"));
      await mkdir(path.dirname(temporary), { recursive: true });
      await mkdir(path.dirname(reference.destination), { recursive: true });
      await writeFile(temporary, reference.serialized);
      replacements.push({ temporary, destination: reference.destination });
    }
    await mkdir(path.dirname(eventDirectory), { recursive: true });
    replacements.push({ temporary: temporaryEvent, destination: eventDirectory });
    await replaceVerifiedTrees(replacements, fileSystemOverrides);
    return {
      changed: true,
      eventDirectory,
      createdReferences: missingReferences.map(({ relativePath }) => relativePath),
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function referencePath(kind, identity) {
  if (kind === "organizer") return `references/organizers/${identity.id}.json`;
  if (kind === "category") return `references/category-catalogs/${identity.organizerId}/${identity.id}/${identity.revision}.json`;
  if (kind === "venue") return `references/venues/${identity.id}.json`;
  if (kind === "space") return `references/venue-spaces/${identity.id}.json`;
  throw new Error(`Unknown reference kind ${kind}.`);
}

function parseDayId(value) {
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

function splitList(value) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

export async function collectEventGeneratorInput({ workspace, ask }) {
  if (typeof ask !== "function") throw new Error("Wizard ask function is required.");
  const root = path.resolve(workspace);
  async function required(question) {
    const answer = String(await ask(question)).trim();
    if (!answer) throw new Error(`${question} is required.`);
    return answer;
  }
  async function optional(question) {
    return String(await ask(question)).trim();
  }
  async function count(question) {
    const value = Number(await required(question));
    if (!Number.isInteger(value) || value < 1) throw new Error(`${question} must be a positive integer.`);
    return value;
  }

  const eventId = await required("活動 eventId");
  const name = await required("活動名稱");
  const dateRangeLabel = await required("日期範圍顯示文字");
  const dataUpdatedAt = await required("資料擷取時間（ISO timestamp）");
  const eventEndsAt = await required("活動結束時間（ISO timestamp）");
  const mapTemplate = await required("地圖 template ID");
  const areaMode = await required("展區模式（single/switchable）");
  const adapter = await required("官方攤位資料 adapter ID");
  const eventUrl = await required("活動官方 HTTPS URL");
  const rightsNote = await required("NOTICE 權利與來源說明（單行）");

  const days = [];
  const boothListUrls = {};
  for (let index = 0, total = await count("活動日／period 數量"); index < total; index += 1) {
    const id = parseDayId(await required(`第 ${index + 1} 個 day／period ID`));
    days.push({
      id,
      label: await required(`第 ${index + 1} 個 day／period 標籤`),
      dateLabel: await required(`第 ${index + 1} 個日期顯示文字`),
    });
    boothListUrls[String(id)] = await required(`第 ${index + 1} 個官方攤位表 HTTPS URL`);
  }

  const areas = [];
  for (let index = 0, total = await count("展區數量"); index < total; index += 1) {
    areas.push({
      id: await required(`第 ${index + 1} 個展區 ID`),
      label: await required(`第 ${index + 1} 個展區名稱`),
      shortLabel: await required(`第 ${index + 1} 個展區短名稱`),
    });
  }

  const references = new Map();
  async function loadOrCreate(relativePath, create) {
    if (references.has(relativePath)) return references.get(relativePath);
    const existing = await readIfExists(path.join(root, ...relativePath.split("/")));
    const record = existing ? parseJson(existing, relativePath) : await create();
    references.set(relativePath, record);
    return record;
  }

  const organizerAssignments = [];
  const selectedOrganizers = [];
  for (let index = 0, total = await count("主辦／協力單位數量"); index < total; index += 1) {
    const id = await required(`第 ${index + 1} 個 organizer stable ID`);
    const role = await required(`第 ${index + 1} 個角色（lead/co-organizer/partner）`);
    const relativePath = referencePath("organizer", { id });
    await loadOrCreate(relativePath, async () => {
      const officialUrl = await required(`新 organizer ${id} 官方 HTTPS URL`);
      const sourceId = "official-page";
      return {
        schema: "organizer/1", id,
        name: await required(`新 organizer ${id} 名稱`),
        officialUrl,
        sources: [{ id: sourceId, kind: "organizer-official", url: officialUrl, retrievedAt: dataUpdatedAt }],
        provenance: { "/name": [sourceId], "/officialUrl": [sourceId] },
      };
    });
    organizerAssignments.push({ organizerId: id, role });
    selectedOrganizers.push({ id, path: relativePath });
  }

  const categoryOrganizerId = await required("分類目錄 organizer stable ID");
  const categoryId = await required("分類目錄 stable ID");
  const categoryRevision = await required("分類目錄 revision");
  const categoryPath = referencePath("category", { organizerId: categoryOrganizerId, id: categoryId, revision: categoryRevision });
  await loadOrCreate(categoryPath, async () => {
    const sourceUrl = await required("分類目錄官方 HTTPS URL");
    const sourceId = "official-page";
    const categories = [];
    for (let index = 0, total = await count("分類數量"); index < total; index += 1) {
      const category = {
        id: await required(`第 ${index + 1} 個分類 ID`),
        label: await required(`第 ${index + 1} 個分類名稱`),
      };
      const description = await optional(`第 ${index + 1} 個分類說明（可留空）`);
      if (description) category.description = description;
      categories.push(category);
    }
    const provenance = {};
    categories.forEach((category, index) => {
      provenance[`/categories/${index}/label`] = [sourceId];
      if (category.description) provenance[`/categories/${index}/description`] = [sourceId];
    });
    return {
      schema: "category-catalog/1", id: categoryId, organizerId: categoryOrganizerId,
      revision: categoryRevision, categories,
      sources: [{ id: sourceId, kind: "organizer-official", url: sourceUrl, retrievedAt: dataUpdatedAt }],
      provenance,
    };
  });

  const venueAssignments = [];
  const selectedVenueMap = new Map();
  for (let index = 0, total = await count("場館空間 assignment 數量"); index < total; index += 1) {
    const venueId = await required(`第 ${index + 1} 個 venue stable ID`);
    const venuePath = referencePath("venue", { id: venueId });
    const venue = await loadOrCreate(venuePath, async () => {
      const officialUrl = await required(`新 venue ${venueId} 官方 HTTPS URL`);
      const sourceId = "official-page";
      return {
        schema: "venue/1", id: venueId,
        name: await required(`新 venue ${venueId} 名稱`),
        officialUrl,
        sources: [{ id: sourceId, kind: "venue-official", url: officialUrl, retrievedAt: dataUpdatedAt }],
        provenance: { "/name": [sourceId], "/officialUrl": [sourceId] },
      };
    });
    const venueSpaceId = await required(`第 ${index + 1} 個 venue-space stable ID`);
    const spacePath = referencePath("space", { id: venueSpaceId });
    await loadOrCreate(spacePath, async () => {
      const sourceUrl = await required(`新 venue-space ${venueSpaceId} 官方 HTTPS URL`);
      const sourceId = "official-page";
      return {
        schema: "venue-space/1", id: venueSpaceId, venueId,
        name: await required(`新 venue-space ${venueSpaceId} 名稱`),
        sources: [{ id: sourceId, kind: "venue-official", url: sourceUrl, retrievedAt: dataUpdatedAt }],
        provenance: { "/name": [sourceId] },
      };
    });
    if (venue.schema !== "venue/1") throw new Error(`${venuePath} is not a venue record.`);
    const selectedVenue = selectedVenueMap.get(venueId) ?? { id: venueId, path: venuePath, spaces: [] };
    selectedVenue.spaces.push({ id: venueSpaceId, path: spacePath });
    selectedVenueMap.set(venueId, selectedVenue);
    venueAssignments.push({
      venueId,
      venueSpaceId,
      areaIds: splitList(await required(`第 ${index + 1} 個 assignment 的展區 IDs（逗號分隔）`)),
    });
  }

  const event = {
    schema: EVENT_DEFINITION_SCHEMA,
    id: eventId,
    name,
    dateRangeLabel,
    dataUpdatedAt,
    eventEndsAt,
    mapTemplate,
    areaMode,
    days,
    areas,
    organizerAssignments,
    categoryCatalog: { organizerId: categoryOrganizerId, id: categoryId, revision: categoryRevision },
    venueAssignments,
    officialData: { adapter, eventUrl, boothListUrls },
  };
  const selection = {
    schema: REFERENCE_SELECTION_SCHEMA,
    eventId,
    organizers: selectedOrganizers,
    categoryCatalog: {
      id: categoryId,
      organizerId: categoryOrganizerId,
      revision: categoryRevision,
      path: categoryPath,
    },
    venues: [...selectedVenueMap.values()],
  };
  const notice = `# ${name}\n\nOfficial source: ${eventUrl}\n\n${rightsNote}`;
  return { event, selection, references, notice };
}
