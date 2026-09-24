import { isOrganizerAreaId, type OrganizerEventDraft } from "./organizer-event";
import { suggestOrganizerBoothCodeWidth, type OrganizerNormalizedImportRow } from "./organizer-import";

type Row = OrganizerNormalizedImportRow;

export function normalizeRosterRow(row: Row, draft: OrganizerEventDraft): Row {
  const text = (value: string) => value.normalize("NFKC").trim();
  const stableKey = row.stableKey ? text(row.stableKey) || null : null;
  return {
    ...row, dayId: text(row.dayId), venueSpaceId: text(row.venueSpaceId),
    areaId: draft.venue.assignments.some(space => space.venueSpaceId === row.venueSpaceId && space.areaMode === "none") ? "ALL" : text(row.areaId),
    codes: row.codes.map(text), circleName: text(row.circleName).replace(/\s+/gu, " "),
    stableKey, identityGroup: stableKey ? `stable:${stableKey}` : null,
  };
}

/** Row positions are local editor addresses, not invented source-file lines. */
export function rosterIssues(rows: readonly Row[], draft: OrganizerEventDraft) {
  const errors = new Map<number, string[]>();
  const add = (index: number, message: string) => errors.set(index, [...(errors.get(index) ?? []), message]);
  const days = new Set(draft.event.days.map(day => day.id));
  const spaces = new Map(draft.venue.assignments.map(space => [space.venueSpaceId, space]));
  const placements = new Map<string, number>();
  rows.forEach((original, index) => {
    const row = normalizeRosterRow(original, draft);
    if (!days.has(row.dayId)) add(index, "請選擇活動設定中的活動日。");
    const space = spaces.get(row.venueSpaceId);
    if (!space) add(index, "請選擇活動設定中的場地。");
    if (space && space.areaMode !== "none" && !isOrganizerAreaId(row.areaId)) add(index, "展區只能使用英數字、底線與連字號。");
    if (!row.circleName || row.circleName.length > 200) add(index, "請填寫 200 字以內的社團名稱。");
    if (!row.codes.length || row.codes.some(code => !code || code.length > 80)) add(index, "每組至少一個攤位代碼，每碼最多 80 字。");
    for (const code of row.codes) {
      if (!code) continue;
      const key = `${row.dayId}\u0000${row.venueSpaceId}\u0000${code.toLocaleLowerCase("en-US")}`;
      const previous = placements.get(key);
      if (previous !== undefined) {
        add(index, `攤位 ${code} 在同一活動日與場地重複。`);
        if (previous !== index) add(previous, `攤位 ${code} 在同一活動日與場地重複。`);
      } else placements.set(key, index);
    }
  });
  return errors;
}

export function suspiciousRosterCodes(row: Row) {
  const width = suggestOrganizerBoothCodeWidth(row.codes);
  return width && row.codes.some(code => [...code].length > width) ? width : null;
}

/** A split keeps explicit identity linkage. Unlinked groups remain unlinked;
 * equal names never manufacture a stable identifier. */
export function splitRosterRow(row: Row, selectedCodes: readonly string[]): Row[] {
  const picked = new Set(selectedCodes);
  const moved = row.codes.filter(code => picked.has(code));
  const remaining = row.codes.filter(code => !picked.has(code));
  return moved.length && remaining.length
    ? [{ ...row, codes: remaining }, { ...row, codes: moved }]
    : [row];
}

export function rosterMergeError(rows: readonly Row[]) {
  if (rows.length < 2) return "請選取至少兩個群組。";
  if (new Set(rows.map(row => row.dayId)).size !== 1 || new Set(rows.map(row => row.venueSpaceId)).size !== 1) return "只能合併同活動日、同場地的群組。";
  if (new Set(rows.map(row => row.areaId)).size !== 1) return "請先將群組改為同一展區，再合併。";
  if (new Set(rows.map(row => row.stableKey || null)).size !== 1) return "主辦內部編號不同，不能直接合併；請先核對社團識別。";
  return null;
}

export function mergeRosterRows(rows: readonly Row[], circleName: string): Row | null {
  if (rosterMergeError(rows) || !rows.some(row => row.circleName === circleName)) return null;
  const first = rows.find(row => row.circleName === circleName)!;
  return { ...first, sourceRow: rows.every(row => row.sourceRow === first.sourceRow) ? first.sourceRow : 0, codes: rows.flatMap(row => row.codes), circleName };
}
