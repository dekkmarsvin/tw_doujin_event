/** 活動草稿表單：基本設定、活動日、場館與使用空間、地圖模板。
 *
 * 由 `organizer-app.tsx` 拆出（#224）。該檔原本是 1870 行的單檔，面板
 * 彼此無關卻共處一室，讀一個面板要先略過另外四個。
 */
import { getMapTemplateShape, listMapTemplateOptions, type MapTemplateShape } from "../map-template-registry";
import { saveOrganizerEvent, type OrganizerEventDetail } from "../organizer-client";
import { nextOrganizerEventDay, type OrganizerEventDraft } from "../organizer-event";
import { type OrganizerVenueCatalog, type OrganizerVenueSpaceAreaMode } from "../organizer-venue-catalog";
import { type OrganizerGuidedTask } from "../organizer-workspace";
import { VenueCatalogCreator } from "./organizer-import-panel";
import { OrganizerReferencePanel } from "./organizer-reference-panel";
import { GUIDED_LABEL, mapTemplatePreview, message, organizerGuidedDraftIssues, type Notice } from "./organizer-shared";
import { OrganizerVenueReferencePanel } from "./organizer-venue-reference-panel";
import styles from "./organizer.module.css";
import { useCallback, useEffect, useState } from "react";

export function DraftForm({
  detail, section, guidedTask, saveLabel = "儲存", secondarySaveLabel,
  onSaved, onSecondarySaved, onChanged, onDirtyChange, onSaveReady, onDraftStateChange, setNotice,
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
  setNotice: (notice: Notice) => void;
}) {
  const [draft, setDraft] = useState(detail.draft);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState(detail.event.version);
  const [venueCatalog, setVenueCatalog] = useState(detail.venueCatalog);
  const [catalogAction, setCatalogAction] = useState<null | { kind: "venue" } | { kind: "space"; venueId: string; assignmentIndex: number }>(null);
  const editable = detail.event.operation !== "AMEND" && (detail.event.status === "draft" || detail.event.status === "changes_requested");
  useEffect(() => {
    onDirtyChange(dirty);
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); onDirtyChange(false); };
  }, [dirty, onDirtyChange]);
  useEffect(() => { onDraftStateChange?.(draft, dirty, venueCatalog); }, [draft, dirty, onDraftStateChange, venueCatalog]);
  const update = (mutate: (current: OrganizerEventDraft) => OrganizerEventDraft) => {
    setDirty(true);
    setDraft((current) => mutate(structuredClone(current)));
  };
  /* Writing the draft is only the first of three calls: the answer is followed
   * by a fresh event list and a fresh detail read, and the panel keeps showing
   * the old readiness until all three land. That whole wait is what the reader
   * experiences as the save, so the buttons stay busy for its full length
   * rather than for the write alone — the shared line at the top of the
   * workspace is too far from the button to read as a reply to the press. */
  const save = useCallback(async (after?: (version: number) => Promise<void>) => {
    setSaving(true);
    setNotice({ kind: "busy", message: "儲存中…" });
    let result: Awaited<ReturnType<typeof saveOrganizerEvent>>;
    try {
      result = await saveOrganizerEvent(detail.event.id, expectedVersion, draft);
    } catch (error) {
      setSaving(false);
      setNotice({ kind: "error", message: message(error) });
      return false;
    }
    setDirty(false);
    setExpectedVersion(result.version);
    try {
      await onChanged();
      if (after) await after(result.version);
      setNotice({ kind: "ok", message: "已儲存。" });
      return true;
    } catch (error) {
      setNotice({ kind: "error", message: `已儲存，但後續動作未完成：${message(error)}` });
      return false;
    } finally {
      setSaving(false);
    }
  }, [detail.event.id, draft, expectedVersion, onChanged, setNotice]);
  useEffect(() => {
    onSaveReady?.(() => save());
    return () => onSaveReady?.(null);
  }, [onSaveReady, save]);
  const taskIssues = guidedTask ? organizerGuidedDraftIssues(draft, guidedTask, venueCatalog) : [];
  const showIdentity = section === "event" && (!guidedTask || guidedTask === "identity_source");
  const showDays = section === "event" && (!guidedTask || guidedTask === "days");
  return <section className={`${styles.panel} ${guidedTask ? styles.guidedForm : ""}`}>
    <div className={styles.panelHead}><div><h3>{guidedTask ? GUIDED_LABEL[guidedTask] : section === "event" ? "活動基本資料" : "場館與使用空間"}</h3></div></div>
    {section === "event" ? <div className={styles.formGrid}>
      {showIdentity && <>
        <label>活動名稱<input disabled={!editable} value={draft.event.name} onChange={(event) => update((next) => { next.event.name = event.target.value; return next; })} /></label>
        <label>活動代碼<input disabled={!editable || detail.event.eventIdLocked} placeholder="pf45-rf14" value={draft.event.id ?? ""} onChange={(event) => update((next) => { next.event.id = event.target.value || null; return next; })} /><small>{detail.event.eventIdLocked ? "首次送審後已鎖定" : "小寫英數字與連字號"}</small></label>
        <label>官方來源說明<input disabled={!editable} value={draft.officialSource.label} onChange={(event) => update((next) => { next.officialSource.label = event.target.value; return next; })} /></label>
        <label>官方來源網址（必填）<input disabled={!editable} required type="url" placeholder="https://" value={draft.officialSource.url ?? ""} onChange={(event) => update((next) => { next.officialSource.url = event.target.value || null; return next; })} /></label>
        <OrganizerReferencePanel candidateId={detail.event.id} expectedVersion={expectedVersion}
          catalog={detail.referenceCatalog} selection={draft.references} editable={editable}
          onChange={(references) => update((next) => ({ ...next, references }))} />
      </>}
      {showDays && <div className={styles.full}><div className={styles.panelHead}><h4>活動日</h4><button type="button" className={styles.secondary} disabled={!editable} onClick={() => update((next) => { next.event.days.push(nextOrganizerEventDay(next.event.days, new Date())); return next; })}>新增日期</button></div>
        {draft.event.days.map((day, index) => <div className={styles.inlineFields} key={`${index}-${day.id}`}>
          <label>代碼<input disabled={!editable} aria-label={`第 ${index + 1} 日代碼`} value={day.id} onChange={(event) => update((next) => { next.event.days[index].id = event.target.value; return next; })} /></label>
          <label>名稱<input disabled={!editable} aria-label={`第 ${index + 1} 日名稱`} value={day.label} onChange={(event) => update((next) => { next.event.days[index].label = event.target.value; return next; })} /></label>
          <label>日期<input disabled={!editable} aria-label={`第 ${index + 1} 日日期`} type="date" value={day.date} onChange={(event) => update((next) => { next.event.days[index].date = event.target.value; return next; })} /></label>
          <button type="button" className={styles.dangerText} disabled={!editable} onClick={() => update((next) => { next.event.days.splice(index, 1); return next; })}>移除</button>
        </div>)}
        {draft.event.days.length === 0 && <div className={styles.inlineEmpty}><p>尚未設定活動日期。</p><button type="button" disabled={!editable} onClick={() => update((next) => { next.event.days.push(nextOrganizerEventDay(next.event.days, new Date())); return next; })}>建立第一個活動日</button></div>}
      </div>}
    </div> : <div>
      {detail.missingVenueReferences?.map((entry) => <OrganizerVenueReferencePanel key={entry.id}
        entry={entry} candidateId={detail.event.id} expectedVersion={expectedVersion}
        disabled={!editable || dirty} onCreated={onChanged} />)}
      <div className={styles.row}>
        <button type="button" className={styles.secondary} disabled={!editable} onClick={() => update((next) => {
          const used = new Set(next.venue.assignments.map((item) => item.venueSpaceId));
          const venue = venueCatalog.venues.find((item) => item.spaces.some((space) => !used.has(space.id))) ?? venueCatalog.venues[0];
          const space = venue?.spaces.find((item) => !used.has(item.id)) ?? venue?.spaces[0];
          next.venue.assignments.push({
            venueId: venue?.id ?? "",
            venueSpaceId: space?.id ?? "",
            areaIds: space?.defaultAreaMode === "none" ? ["ALL"] : [],
            mapTemplate: "TAIWAN_GENERIC_V1",
            areaMode: space?.defaultAreaMode ?? "imported",
          });
          return next;
        })}>新增使用空間</button>
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
            const assignmentIndex = catalogAction.kind === "space" ? catalogAction.assignmentIndex : next.venue.assignments.length;
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
      {draft.venue.assignments.map((assignment, index) => {
        const selectedVenue = venueCatalog.venues.find((venue) => venue.id === assignment.venueId);
        const spaces = selectedVenue?.spaces ?? [];
        const selectedSpace = spaces.find((space) => space.id === assignment.venueSpaceId);
        return <div className={styles.venueCard} key={index}>
          <label>場館<select disabled={!editable} value={assignment.venueId} onChange={(event) => update((next) => {
            const venue = venueCatalog.venues.find((item) => item.id === event.target.value);
            const used = new Set(next.venue.assignments.filter((_, itemIndex) => itemIndex !== index).map((item) => item.venueSpaceId));
            const space = venue?.spaces.find((item) => !used.has(item.id)) ?? venue?.spaces[0];
            next.venue.assignments[index] = {
              ...next.venue.assignments[index], venueId: venue?.id ?? "", venueSpaceId: space?.id ?? "",
              areaIds: space?.defaultAreaMode === "none" ? ["ALL"] : [], areaMode: space?.defaultAreaMode ?? "imported",
            };
            return next;
          })}><option value="">請選擇場館</option>{venueCatalog.venues.map((venue) => <option value={venue.id} key={venue.id}>{venue.name}</option>)}{assignment.venueId && !selectedVenue && <option value={assignment.venueId}>原場館已不存在</option>}</select><small>從清單選擇即可，不需自行輸入。</small></label>
          <label>使用空間<select disabled={!editable || !selectedVenue} value={assignment.venueSpaceId} onChange={(event) => update((next) => {
            const space = spaces.find((item) => item.id === event.target.value);
            next.venue.assignments[index].venueSpaceId = space?.id ?? "";
            next.venue.assignments[index].areaMode = space?.defaultAreaMode ?? "imported";
            next.venue.assignments[index].areaIds = space?.defaultAreaMode === "none" ? ["ALL"] : [];
            return next;
          })}><option value="">請選擇使用空間</option>{spaces.map((space) => <option value={space.id} key={space.id}>{space.name}</option>)}{assignment.venueSpaceId && !selectedSpace && <option value={assignment.venueSpaceId}>原使用空間已不存在</option>}</select><small>場館內的館別或樓層，一個空間一張地圖。</small><button type="button" className={styles.textButton} disabled={!editable || !selectedVenue} onClick={() => selectedVenue && setCatalogAction({ kind: "space", venueId: selectedVenue.id, assignmentIndex: index })}>找不到空間？立即新增</button></label>
          <label>展區方式<select disabled={!editable} value={assignment.areaMode ?? "imported"} onChange={(event) => update((next) => {
            const areaMode = event.target.value as OrganizerVenueSpaceAreaMode;
            next.venue.assignments[index].areaMode = areaMode;
            next.venue.assignments[index].areaIds = areaMode === "none" ? ["ALL"] : [];
            return next;
          })}><option value="imported">由攤位名單帶入</option><option value="none">無分區</option></select><small>{assignment.areaMode === "none" ? "匯入時自動使用 ALL，不需展區欄。" : assignment.areaIds.length > 0 ? `已匯入：${assignment.areaIds.join("、")}` : "尚未匯入攤位。"}</small></label>
          <label>地圖模板<select disabled={!editable} value={assignment.mapTemplate} onChange={(event) => update((next) => { next.venue.assignments[index].mapTemplate = event.target.value; return next; })}>
            {listMapTemplateOptions().map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
            {!listMapTemplateOptions().some((option) => option.id === assignment.mapTemplate) && <option value={assignment.mapTemplate}>{assignment.mapTemplate}</option>}
          </select><MapTemplatePreview template={assignment.mapTemplate} /></label>
          <button type="button" className={styles.dangerText} disabled={!editable} onClick={() => update((next) => { next.venue.assignments.splice(index, 1); return next; })}>移除此空間</button>
        </div>;
      })}
      {draft.venue.assignments.length === 0 && <div className={styles.inlineEmpty}><p>尚未選擇場館與使用空間。</p><button type="button" disabled={!editable} onClick={() => setCatalogAction({ kind: "venue" })}>建立新場館</button></div>}
    </div>}
    {taskIssues.length > 0 && <div className={styles.taskIssues} aria-live="polite">{taskIssues.map((issue, index) => <p key={`${issue.code}-${index}`}>{issue.message}</p>)}</div>}
    <div className={styles.formActions}>
      <button type="button" disabled={!editable || saving} onClick={() => { void save(onSaved); }}>{saving ? "儲存中…" : saveLabel}</button>
      {secondarySaveLabel && <button type="button" className={styles.secondary} disabled={!editable || saving} onClick={() => { void save(onSecondarySaved); }}>{secondarySaveLabel}</button>}
      <span aria-live="polite">{saving ? "儲存中，請稍候。" : dirty ? "尚有未儲存變更" : "目前沒有未儲存的變更"}</span>
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
