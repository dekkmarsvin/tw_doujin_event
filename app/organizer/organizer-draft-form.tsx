/** 活動草稿表單：基本設定、活動日、場館與場地、地圖模板。
 *
 * 由 `organizer-app.tsx` 拆出（#224）。該檔原本是 1870 行的單檔，面板
 * 彼此無關卻共處一室，讀一個面板要先略過另外四個。
 */
import { EVENT_ALIAS_MAX_COUNT } from "../event-aliases";
import { getMapTemplateShape, listMapTemplateOptions, type MapTemplateShape } from "../map-template-registry";
import { saveOrganizerEvent, type OrganizerEventDetail } from "../organizer-client";
import { nextOrganizerEventDay, ORGANIZER_DEFAULT_SOURCE_LABEL, organizerPendingVenueSelections, type OrganizerEventDraft } from "../organizer-event";
import { validateOrganizerVenueCatalogAssignments, type OrganizerVenueCatalog, type OrganizerVenueSpaceAreaMode } from "../organizer-venue-catalog";
import { type OrganizerGuidedTask } from "../organizer-workspace";
import { VenueCatalogCreator } from "./organizer-import-panel";
import { OrganizerReferencePanel } from "./organizer-reference-panel";
import { EventImageField } from "./organizer-event-image";
import { GUIDED_LABEL, TASK_QUESTION, mapTemplatePreview, message, organizerGuidedDraftIssues } from "./organizer-shared";
import { OrganizerVenueAddressPanel, OrganizerVenueReferencePanel } from "./organizer-venue-reference-panel";
import { VenueLayerGuide } from "./organizer-venue-layers";
import styles from "./organizer.module.css";
import { useCallback, useEffect, useState } from "react";

const emptyVenueAssignment = (): OrganizerEventDraft["venue"]["assignments"][number] => ({
  venueId: "", venueSpaceId: "", areaIds: [], mapTemplate: "TAIWAN_GENERIC_V1", areaMode: "imported",
});

export function DraftForm({
  detail, section, guidedTask, saveLabel = "儲存", secondarySaveLabel,
  onSaved, onSecondarySaved, onChanged, onDirtyChange, onSaveReady, onDraftStateChange,
}: {
  detail: OrganizerEventDetail;
  section: "event" | "venue";
  guidedTask?: OrganizerGuidedTask;
  saveLabel?: string;
  secondarySaveLabel?: string;
  onSaved?: (version: number) => Promise<void>;
  onSecondarySaved?: (version: number) => Promise<void>;
  onChanged: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onSaveReady?: (save: (() => Promise<boolean>) | null) => void;
  onDraftStateChange?: (draft: OrganizerEventDraft, dirty: boolean, catalog: OrganizerVenueCatalog) => void;
}) {
  const [draft, setDraft] = useState(detail.draft);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  /* A task opened for the first time is not a task filled in wrongly. The
   * issue list is what the save says back, so it waits for the press -- except
   * where it is also the reason the button is disabled, which must never be
   * unexplained (#221 4.1). */
  const [attempted, setAttempted] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState(detail.event.version);
  const [loadedVersion, setLoadedVersion] = useState(detail.event.version);
  const [venueCatalog, setVenueCatalog] = useState(detail.venueCatalog);
  const [catalogAction, setCatalogAction] = useState<null | { kind: "venue" } | { kind: "space"; venueId: string; assignmentIndex: number }>(null);
  const editable = detail.event.operation !== "AMEND" && (detail.event.status === "draft" || detail.event.status === "changes_requested");
  // A refresh may normalize saved input. Adopt it without erasing the save
  // result, but never pair unsaved edits with somebody else's newer version.
  if (!dirty && loadedVersion !== detail.event.version && detail.event.version >= expectedVersion) {
    setLoadedVersion(detail.event.version);
    setExpectedVersion(detail.event.version);
    setDraft(detail.draft);
    setVenueCatalog(detail.venueCatalog);
  }
  useEffect(() => {
    onDirtyChange(dirty);
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); onDirtyChange(false); };
  }, [dirty, onDirtyChange]);
  useEffect(() => { onDraftStateChange?.(draft, dirty, venueCatalog); }, [draft, dirty, onDraftStateChange, venueCatalog]);
  const update = (mutate: (current: OrganizerEventDraft) => OrganizerEventDraft) => {
    setDirty(true);
    // Editing again makes the last save a description of a different
    // moment, so it stops being shown rather than sitting beside "尚有未儲存變更".
    setResult(null);
    setDraft((current) => mutate(structuredClone(current)));
  };
  // Show the first question immediately without making an untouched form dirty
  // or saving a placeholder that the venue catalog correctly rejects.
  const venueAssignments = draft.venue.assignments.length > 0 ? draft.venue.assignments : [emptyVenueAssignment()];
  const updateVenue = (mutate: (current: OrganizerEventDraft) => OrganizerEventDraft) => update((next) => {
    if (next.venue.assignments.length === 0) next.venue.assignments.push(emptyVenueAssignment());
    return mutate(next);
  });
  /* Writing the draft is only the first of three calls: the answer is followed
   * by a fresh event list and a fresh detail read, and the panel keeps showing
   * the old readiness until all three land. That whole wait is what the reader
   * experiences as the save, so the buttons stay busy for its full length
   * rather than for the write alone — the shared line at the top of the
   * workspace is too far from the button to read as a reply to the press. */
  const save = useCallback(async (after?: (version: number) => Promise<void>, requireTask = false) => {
    setAttempted(true);
    /* 儲存並繼續 checks the task it is standing on, and an incomplete one keeps
     * what was typed, says what is missing and does not move on. 儲存並離開 and
     * the leave dialog pass through: a half-finished draft is a legitimate
     * thing to store and come back to (#221 4.2, 4.3). */
    if (requireTask && guidedTask && organizerGuidedDraftIssues(draft, guidedTask, venueCatalog).length > 0) {
      setResult({ ok: false, text: "上方還有沒填完的項目，補齊後才能繼續。" });
      return false;
    }
    setSaving(true);
    setResult(null);
    let result: Awaited<ReturnType<typeof saveOrganizerEvent>>;
    try {
      result = await saveOrganizerEvent(detail.event.id, expectedVersion, draft);
    } catch (error) {
      setSaving(false);
      setResult({ ok: false, text: message(error) });
      return false;
    }
    setDirty(false);
    setExpectedVersion(result.version);
    try {
      await onChanged();
      if (after) await after(result.version);
      setResult({ ok: true, text: "已儲存。" });
      return true;
    } catch (error) {
      setResult({ ok: false, text: `已儲存，但後續動作未完成：${message(error)}` });
      return false;
    } finally {
      setSaving(false);
    }
  }, [detail.event.id, draft, expectedVersion, guidedTask, onChanged, venueCatalog]);
  useEffect(() => {
    onSaveReady?.(() => save());
    return () => onSaveReady?.(null);
  }, [onSaveReady, save]);
  /* Saving refuses an unchosen or dangling assignment with 422, so the venue
   * section states the refusal beside the button rather than letting the
   * press earn it. Guided mode already lists these among its task issues. */
  const venueIssues = section === "venue"
    ? [...organizerPendingVenueSelections(draft), ...validateOrganizerVenueCatalogAssignments(draft.venue.assignments, venueCatalog)]
    : [];
  const taskIssues = guidedTask ? organizerGuidedDraftIssues(draft, guidedTask, venueCatalog) : venueIssues;
  const showIdentity = section === "event" && (!guidedTask || guidedTask === "identity_source");
  const showDays = section === "event" && (!guidedTask || guidedTask === "days");
  return <section className={`${styles.panel} ${guidedTask ? styles.guidedForm : ""}`}>
    <div className={styles.panelHead}><div><h3>{guidedTask ? GUIDED_LABEL[guidedTask] : section === "event" ? "活動基本資料" : "場館與場地"}</h3>
      {guidedTask && <p>{TASK_QUESTION[guidedTask]}</p>}</div></div>
    <fieldset className={styles.formFields} disabled={saving} aria-label={guidedTask ? GUIDED_LABEL[guidedTask] : section === "event" ? "活動基本資料欄位" : "場館與場地欄位"}>
    {section === "event" ? <div className={styles.formGrid}>
      {showIdentity && <>
        <label>活動名稱<input disabled={!editable} value={draft.event.name} onChange={(event) => update((next) => { next.event.name = event.target.value; return next; })} /><small>例如：秋日同人交流會 2026</small></label>
        <div className={styles.full}><div className={styles.panelHead}><h4>活動別稱</h4><button type="button" className={styles.secondary}
          disabled={!editable || (draft.event.aliases?.length ?? 0) >= EVENT_ALIAS_MAX_COUNT}
          onClick={() => update((next) => { next.event.aliases = [...(next.event.aliases ?? []), ""]; return next; })}>新增別稱</button></div>
          <small>讀者常用的其他稱呼，例如：FF47、開拓動漫祭 47。第一個會當作簡稱。</small>
          {(draft.event.aliases ?? []).map((alias, index) => <div className={styles.inlineFields} key={index}>
            <label>別稱 {index + 1}<input disabled={!editable} value={alias} onChange={(event) => update((next) => { next.event.aliases![index] = event.target.value; return next; })} /></label>
            <button type="button" className={styles.dangerText} disabled={!editable} aria-label={`移除別稱 ${index + 1}`} onClick={() => update((next) => { next.event.aliases!.splice(index, 1); return next; })}>移除</button>
          </div>)}
        </div>
        <label>活動代碼<input disabled={!editable || detail.event.eventIdLocked} placeholder="pf45-rf14" value={draft.event.id ?? ""} onChange={(event) => update((next) => { next.event.id = event.target.value || null; return next; })} /><small>{detail.event.eventIdLocked ? "首次送審後已鎖定" : "例如：autumn-doujin-2026。使用小寫英數字與連字號；首次送審後不能修改。"}</small></label>
        <label>官方公告網址<input disabled={!editable} required type="url" placeholder="https://" value={draft.officialSource.url ?? ""} onChange={(event) => update((next) => { next.officialSource.url = event.target.value || null; return next; })} /><small>貼上主辦單位的活動頁或公告貼文網址。</small></label>
        <label>來源名稱（選填）<input disabled={!editable} placeholder={ORGANIZER_DEFAULT_SOURCE_LABEL} value={draft.officialSource.label} onChange={(event) => update((next) => { next.officialSource.label = event.target.value; return next; })} /><small>留空時顯示「{ORGANIZER_DEFAULT_SOURCE_LABEL}」。</small></label>
        <EventImageField candidateId={detail.event.id} image={draft.event.image} editable={editable}
          onChange={(image) => update((next) => { if (image) next.event.image = image; else delete next.event.image; return next; })} />
        <OrganizerReferencePanel candidateId={detail.event.id} expectedVersion={expectedVersion}
          catalog={detail.referenceCatalog} selection={draft.references} editable={editable}
          eventSourceUrl={draft.officialSource.url ?? ""}
          onChange={(references) => update((next) => ({ ...next, references }))} />
      </>}
      {showDays && <div className={styles.full}><div className={styles.panelHead}><h4>活動日</h4><button type="button" className={styles.secondary} disabled={!editable} onClick={() => update((next) => { next.event.days.push(nextOrganizerEventDay(next.event.days, new Date())); return next; })}>新增一天</button></div>
        {draft.event.days.map((day, index) => <div className={styles.inlineFields} key={`${index}-${day.id}`}>
          <label>{day.label || `第 ${index + 1} 天`}<input disabled={!editable} aria-label={`${day.label || `第 ${index + 1} 天`}日期`} type="date" value={day.date} onChange={(event) => update((next) => { next.event.days[index].date = event.target.value; return next; })} /></label>
          <details className={styles.dayAdvanced}><summary>改這一天的名稱或代碼</summary>
            <label>名稱<input disabled={!editable} aria-label={`第 ${index + 1} 天名稱`} value={day.label} onChange={(event) => update((next) => { next.event.days[index].label = event.target.value; return next; })} /></label>
            <label>代碼<input disabled={!editable} aria-label={`第 ${index + 1} 天代碼`} value={day.id} onChange={(event) => update((next) => { next.event.days[index].id = event.target.value; return next; })} /><small>攤位名單用這個代碼指到這一天，通常不需要改。</small></label>
          </details>
          <button type="button" className={styles.dangerText} disabled={!editable} onClick={() => update((next) => { next.event.days.splice(index, 1); return next; })}>移除</button>
        </div>)}
        {draft.event.days.length === 0 && <div className={styles.inlineEmpty}><p>尚未設定活動日期。</p><button type="button" disabled={!editable} onClick={() => update((next) => { next.event.days.push(nextOrganizerEventDay(next.event.days, new Date())); return next; })}>建立第一個活動日</button></div>}
      </div>}
    </div> : <div>
      <div role="group" aria-label="活動日期" className={styles.venueDates}>
        {draft.event.days.map((day, index) => <label key={`${index}-${day.id}`}>{day.label || `第 ${index + 1} 天`}
          <input type="date" aria-label={`${day.label || `第 ${index + 1} 天`}日期`} value={day.date} readOnly />
        </label>)}
      </div>
      <p>{draft.event.days.length > 0 ? "以下場館與場地套用至所有活動日。" : `尚未設定活動日期，請先到「${guidedTask ? "活動日期" : "活動"}」填寫。`}</p>
      {detail.missingVenueReferences?.map((entry) => <OrganizerVenueReferencePanel key={entry.id}
        entry={entry} candidateId={detail.event.id} expectedVersion={expectedVersion}
        disabled={!editable || dirty} onCreated={onChanged} />)}
      {/* The address belongs to the shared venue record, not to this event's
        * settings, so a correction can add it while those stay read-only. */}
      {detail.missingVenueAddresses?.map((entry) => <OrganizerVenueAddressPanel key={entry.id}
        entry={entry} candidateId={detail.event.id} expectedVersion={expectedVersion}
        disabled={dirty || (detail.event.status !== "draft" && detail.event.status !== "changes_requested")} onCreated={onChanged} />)}
      <div className={styles.panelHead}>
        <h4>活動場館與場地</h4>
        <button type="button" className={styles.ghost} disabled={!editable} onClick={() => setCatalogAction({ kind: "venue" })}>建立新場館</button>
      </div>
      {catalogAction && <VenueCatalogCreator
        candidateId={detail.event.id}
        venue={catalogAction.kind === "space" ? venueCatalog.venues.find((item) => item.id === catalogAction.venueId) ?? null : null}
        onCancel={() => setCatalogAction(null)}
        onCreated={(createdVenue, space) => {
          setVenueCatalog((current) => ({
            venues: createdVenue
              ? [...current.venues, createdVenue]
              : current.venues.map((venue) => venue.id === space.venueId ? { ...venue, spaces: [...venue.spaces, space] } : venue),
          }));
          update((next) => {
            const emptyIndex = next.venue.assignments.findIndex((assignment) => !assignment.venueId && !assignment.venueSpaceId);
            const assignmentIndex = catalogAction.kind === "space" ? catalogAction.assignmentIndex
              : emptyIndex >= 0 ? emptyIndex : next.venue.assignments.length;
            const selected = {
              venueId: space.venueId,
              venueSpaceId: space.id,
              areaIds: space.defaultAreaMode === "none" ? ["ALL"] : [],
              mapTemplate: "TAIWAN_GENERIC_V1",
              areaMode: space.defaultAreaMode,
            };
            if (assignmentIndex < next.venue.assignments.length) next.venue.assignments[assignmentIndex] = selected;
            else next.venue.assignments.push(selected);
            return next;
          });
          setCatalogAction(null);
        }}
      />}
      {venueAssignments.map((assignment, index) => {
        const selectedVenue = venueCatalog.venues.find((venue) => venue.id === assignment.venueId);
        const spaces = selectedVenue?.spaces ?? [];
        const selectedSpace = spaces.find((space) => space.id === assignment.venueSpaceId);
        return <div className={`${styles.venueCard} ${guidedTask ? styles.guidedVenueCard : ""}`} key={index}>
          <label>場館<select disabled={!editable} value={assignment.venueId} onChange={(event) => updateVenue((next) => {
            // Changing the venue invalidates whatever space sat under it, and
            // choosing the replacement belongs to the owner for the same
            // reason the first choice did.
            const venue = venueCatalog.venues.find((item) => item.id === event.target.value);
            next.venue.assignments[index] = {
              ...next.venue.assignments[index], venueId: venue?.id ?? "", venueSpaceId: "",
              areaIds: [], areaMode: "imported",
            };
            return next;
          })}><option value="">請選擇場館</option>{venueCatalog.venues.map((venue) => <option value={venue.id} key={venue.id}>{venue.name}</option>)}{assignment.venueId && !selectedVenue && <option value={assignment.venueId}>原場館已不存在</option>}</select></label>
          <label>場地<select disabled={!editable || !selectedVenue} value={assignment.venueSpaceId} onChange={(event) => updateVenue((next) => {
            const space = spaces.find((item) => item.id === event.target.value);
            next.venue.assignments[index].venueSpaceId = space?.id ?? "";
            next.venue.assignments[index].areaMode = space?.defaultAreaMode ?? "imported";
            next.venue.assignments[index].areaIds = space?.defaultAreaMode === "none" ? ["ALL"] : [];
            return next;
          })}><option value="">請選擇場地</option>{spaces.map((space) => <option value={space.id} key={space.id}>{space.name}</option>)}{assignment.venueSpaceId && !selectedSpace && <option value={assignment.venueSpaceId}>原場地已不存在</option>}</select><small>例如：全館、1F 展場、2F 展場。一個場地一張地圖。</small><button type="button" className={styles.textButton} disabled={!editable || !selectedVenue} onClick={() => selectedVenue && setCatalogAction({ kind: "space", venueId: selectedVenue.id, assignmentIndex: index })}>找不到場地？立即新增</button></label>
          <label>攤位名單有另外區分展區嗎？<select disabled={!editable || !selectedSpace} value={assignment.areaMode ?? "imported"} onChange={(event) => updateVenue((next) => {
            const areaMode = event.target.value as OrganizerVenueSpaceAreaMode;
            next.venue.assignments[index].areaMode = areaMode;
            next.venue.assignments[index].areaIds = areaMode === "none" ? ["ALL"] : [];
            return next;
          })}><option value="imported">依名單中的展區欄位區分</option><option value="none">沒有分區</option></select><small>{assignment.areaMode === "none" ? "這個場地沒有分區，匯入不用對應展區欄。" : assignment.areaIds.length > 0 ? `已匯入：${assignment.areaIds.join("、")}` : "尚未匯入攤位。"}</small></label>
          {!guidedTask && <label>地圖模板<select disabled={!editable || !selectedSpace} value={assignment.mapTemplate} onChange={(event) => updateVenue((next) => { next.venue.assignments[index].mapTemplate = event.target.value; return next; })}>
            {listMapTemplateOptions().map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
            {!listMapTemplateOptions().some((option) => option.id === assignment.mapTemplate) && <option value={assignment.mapTemplate}>{assignment.mapTemplate}</option>}
          </select><MapTemplatePreview template={assignment.mapTemplate} /></label>}
          {draft.venue.assignments.length > 0 && <button type="button" className={styles.dangerText} disabled={!editable} onClick={() => update((next) => { next.venue.assignments.splice(index, 1); return next; })}>移除此場地</button>}
        </div>;
      })}
      <button type="button" className={styles.secondary} disabled={!editable || venueAssignments.some((assignment) => !assignment.venueId || !assignment.venueSpaceId)} onClick={() => update((next) => {
        next.venue.assignments.push(emptyVenueAssignment());
        return next;
      })}>再選一個場地</button>
      <VenueLayerGuide open />
    </div>}
    </fieldset>
    {/* The same pending item is also listed in 準備進度, so this block carries a
        name: a reader arriving at the announcement needs to know which of the
        two they are hearing, and it is the one beside the controls that fix it. */}
    {(attempted || venueIssues.length > 0) && taskIssues.length > 0 && <div className={styles.taskIssues} role="group" aria-label="這個表單尚待完成的項目" aria-live="polite">{taskIssues.map((issue, index) => <p key={`${issue.code}-${index}`}>{issue.message}</p>)}</div>}
    <div className={styles.formActions}>
      <button type="button" disabled={!editable || saving || venueIssues.length > 0} onClick={() => { void save(onSaved, true); }}>{saving ? "儲存中…" : saveLabel}</button>
      {secondarySaveLabel && <button type="button" className={styles.secondary} disabled={!editable || saving || venueIssues.length > 0} onClick={() => { void save(onSecondarySaved); }}>{secondarySaveLabel}</button>}
      {/* One line, one truth. The result replaces the dirty state rather than
          sitting beside a contradiction of it. */}
      <span aria-live="polite" className={result && !result.ok ? styles.error : undefined}>
        {saving ? "儲存中，請稍候。" : result ? result.text
          : venueIssues.length > 0 ? "請先處理上方列出的問題，才能儲存。"
          : dirty ? "尚有未儲存變更" : "目前沒有未儲存的變更"}
      </span>
    </div>
  </section>;
}

/** The schematic is drawn from the same shape validation enforces, so it can
 * only ever show a floor the template would actually accept. Bar height is the
 * row's slot count, which is what makes the short A row and the horizontal W
 * row read as themselves rather than as decoration. */
function MapTemplateSchematic({ shape }: { shape: MapTemplateShape | null }) {
  const width = 240;
  const height = 96;
  if (!shape) {
    return <svg className={styles.schematic} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="沒有固定版面，可自由編輯攤位排列">
      <rect x="1" y="1" width={width - 2} height={height - 2} rx="7" fill="none" stroke="currentColor" strokeDasharray="6 5" opacity=".45" />
      <text x={width / 2} y={height / 2 + 4} textAnchor="middle" fontSize="11" fill="currentColor" opacity=".6">自由編輯</text>
    </svg>;
  }
  const vertical = shape.rows.filter((row) => row.orientation === "vertical");
  const horizontal = shape.rows.filter((row) => row.orientation === "horizontal");
  const tallest = Math.max(...shape.rows.map((row) => row.slots));
  const floor = horizontal.length > 0 ? height - 22 : height - 8;
  const pitch = (width - 16) / vertical.length;
  return <svg className={styles.schematic} viewBox={`0 0 ${width} ${height}`} role="img"
    aria-label={`${shape.rows.length} 個攤位排，共 ${shape.rows.reduce((total, row) => total + row.slots, 0)} 個攤位格`}>
    {vertical.map((row, index) => {
      const bar = (floor - 10) * (row.slots / tallest);
      return <rect key={row.label} x={8 + index * pitch} y={floor - bar} width={Math.max(2, pitch - 3)} height={bar} rx="1.5"
        fill="currentColor" opacity=".38" />;
    })}
    {horizontal.map((row) => <rect key={row.label} x="8" y={floor + 6} width={width - 16} height="7" rx="2"
      fill="currentColor" opacity=".38" />)}
    <text x="8" y={height - 3} fontSize="8" fill="currentColor" opacity=".55">{vertical[0]?.label}–{vertical[vertical.length - 1]?.label} 直排</text>
    {horizontal.length > 0 && <text x={width - 8} y={height - 3} textAnchor="end" fontSize="8" fill="currentColor" opacity=".55">{horizontal.map((row) => row.label).join("、")} 橫排</text>}
  </svg>;
}

function MapTemplatePreview({ template }: { template: string }) {
  const preview = mapTemplatePreview(template);
  return <div className={styles.templatePreview}>
    <MapTemplateSchematic shape={getMapTemplateShape(template)} />
    <p>{preview.summary}</p>
    <ul><li>{preview.recognizer}</li><li>{preview.shape}</li></ul>
  </div>;
}
