/** 檢查與發布的檢查區：驗證問題卡與 Reader 預覽。
 *
 * 由 `organizer-app.tsx` 拆出（#224）。該檔原本是 1870 行的單檔，面板
 * 彼此無關卻共處一室，讀一個面板要先略過另外四個。檢查原本是獨立區段，
 * 併入送審面板後，進入時直接跑一次檢查，送審前不必先記得按。
 */
import { organizerIssueTarget } from "./organizer-field-guidance";
import type { OrganizerWorkspaceSection } from "../organizer-workspace";
import AccessibleEventMapRenderer from "../accessible-event-map-renderer";
import { previewOrganizerEvent, validateOrganizerEvent, type OrganizerEventDetail, type OrganizerReaderPreview } from "../organizer-client";
import { type OrganizerValidationIssue } from "../organizer-event";
import { type OrganizerVenueCatalog } from "../organizer-venue-catalog";
import { STEP_LABEL, organizerDayLabel, organizerIssueMessage, organizerVenueSpaceLabel } from "./organizer-shared";
import styles from "./organizer.module.css";
import { ActionNotice, useActionFeedback } from "./organizer-feedback";
import { useEffect, useMemo, useRef, useState } from "react";

/* The check is where the complete list of blocking issues is asked for, so
 * its line says which of the three situations the reader is in rather than
 * repeating that previews are private (#221 4.5, Phase 5). */
const CHECK_STATE = {
  complete: "這一版已通過檢查。可以建立預覽。",
  available: "這一版還沒通過檢查。",
  blocked: "前面的項目還沒完成。",
};

export function CheckSection({ detail, onChanged, onSection }: { detail: OrganizerEventDetail; onChanged: () => Promise<void>; onSection?: (section: OrganizerWorkspaceSection, target?: string) => void }) {
  const { readiness } = detail.workspace;
  const editable = detail.event.status === "draft" || detail.event.status === "changes_requested";
  const checkState = readiness.sections.find((item) => item.id === "review")?.state === "blocked" ? "blocked"
    : readiness.blockers.some((blocker) => blocker.code === "validation_required") ? "available"
      : "complete";
  const [issues, setIssues] = useState<OrganizerValidationIssue[] | null>(null);
  const [preview, setPreview] = useState<OrganizerReaderPreview | null>(null);
  const checkFeedback = useActionFeedback();
  const previewFeedback = useActionFeedback();
  // The preview renders below a list that is often longer than the screen, so
  // without this the button looked like it did nothing (#220 decision 4).
  const previewRef = useRef<HTMLDivElement | null>(null);
  const grouped = useMemo(() => issues ? { errors: issues.filter((issue) => issue.severity === "error"), warnings: issues.filter((issue) => issue.severity === "warning") } : null, [issues]);
  const runCheck = () => {
    previewFeedback.clear();
    void checkFeedback.run(validateOrganizerEvent(detail.event.id).then(async (result) => { setIssues(result.issues); await onChanged(); }), "檢查完成。");
  };
  // Entering the section is asking where the draft stands, so the check runs
  // once without a press while there is still something to submit. The ref
  // keeps StrictMode's second effect pass from sending it twice.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (autoChecked.current || !editable) return;
    autoChecked.current = true;
    runCheck();
    // Once per mount; the panel remounts when the candidate version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className={styles.subpanel}>
    <div className={styles.panelHead}><div><h4>檢查與預覽</h4><p>{CHECK_STATE[checkState]}</p></div><div className={styles.panelActions}><div className={styles.row}>
      <button type="button" disabled={checkFeedback.pending || previewFeedback.pending} onClick={runCheck}>{issues === null ? "執行檢查" : "重新檢查"}</button>
      <button type="button" className={styles.ghost} disabled={previewFeedback.pending || checkFeedback.pending} onClick={() => {
        checkFeedback.clear();
        void previewFeedback.run(previewOrganizerEvent(detail.event.id).then((result) => { setIssues(result.issues); setPreview(result.preview); }), "預覽已產生。")
          .then((ok) => { if (ok) previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); });
      }}>建立預覽</button>
    </div><ActionNotice notice={checkFeedback.notice} /><ActionNotice notice={previewFeedback.notice} /></div></div>
    {grouped && <div className={styles.validationSummary}><b>{grouped.errors.length} 項必須修正</b><span>{grouped.warnings.length} 項建議確認</span></div>}
    {issues?.map((issue, index) => <OrganizerValidationIssueCard key={`${issue.code}-${index}`} issue={issue} detail={detail} onSection={onSection} />)}
    <div ref={previewRef}>{preview !== null && <OrganizerReaderPreviewPanel preview={preview} venueCatalog={detail.venueCatalog} />}</div>
  </div>;
}

export function OrganizerValidationIssueCard({ issue, detail, onSection }: { issue: OrganizerValidationIssue; detail: OrganizerEventDetail; onSection?: (section: OrganizerWorkspaceSection, target?: string) => void }) {
  const amendment = detail.event.operation === "AMEND";
  const [dayId, venueSpaceId] = issue.step === "map" ? (issue.target ?? "").split("/") : [];
  const scopeLabel = dayId && venueSpaceId
    ? `${organizerDayLabel(detail.draft.event.days, dayId)}・${organizerVenueSpaceLabel(detail.venueCatalog, venueSpaceId)}` : null;
  const unknown = issue.step === "map" && issue.code === "unknown_booth";
  const missing = issue.step === "map" && issue.code === "missing_booth";
  const rows = detail.import?.rows.filter((row) => row.dayId === dayId && row.venueSpaceId === venueSpaceId) ?? [];
  const rowsByCode = new Map(rows.flatMap((row) => row.codes.map((code) => [code, row] as const)));
  // One translator for both surfaces: this card used to keep its own copy of
  // the two booth sentences, which is why the sidebar still showed the
  // validator's poorer one beside it (#223).
  const description = organizerIssueMessage(issue, detail.venueCatalog, detail.draft);
  const repairTarget = (issue.step === "event" || issue.step === "venue") ? organizerIssueTarget(issue, detail.draft) : undefined;
  return <div className={issue.severity === "error" ? styles.issueError : styles.issueWarning}>
    <p><b>{issue.severity === "error" ? "必須修正" : "建議確認"}・{STEP_LABEL[issue.step]}</b>{scopeLabel && <>・{scopeLabel}</>}<br />{description}</p>
    {onSection && !amendment && repairTarget && <button type="button" className={styles.issueLink} onClick={() => onSection(issue.step === "venue" ? "venue" : "event", repairTarget)}>前往修正</button>}
    {(unknown || missing) && <>
      <p>比對來源：已儲存的地圖 ↔ {detail.import ? `${detail.import.source.fileName}${detail.import.source.worksheet ? `／工作表「${detail.import.source.worksheet}」` : ""}` : "尚無匯入資料"}（此活動日與場地共 {rows.length} 筆匯入資料）。</p>
      <p>{amendment ? "請到「地圖」對照修正後的攤位位置與代碼；若修正宣告有誤，請到「名單修正」調整並儲存。未分配給社團的空攤位可以保留。" : unknown
        ? "請到「地圖」對照主辦配置圖，確認代碼是否打錯；也請到「攤位名單」檢查活動日、場地與攤位代碼。若確定是未分配給社團的空攤位，可保留，不影響送審。"
        : "請到「地圖」確認是否漏畫攤位或代碼不同（例如 A1 與 A01）；若匯入資料的日期、場地或代碼有誤，請到「攤位名單」修正後重新儲存。"}</p>
      <p>修正並儲存後，請重新執行檢查。</p>
    </>}
    {!!issue.boothCodes?.length && <details>
      <summary>查看全部 {issue.boothCodes.length} 個攤位代碼{missing ? "與匯入資料列" : ""}</summary>
      <div className={styles.validationCodes}><ul>{issue.boothCodes.map((code) => {
        const row = rowsByCode.get(code);
        return <li key={code}><code>{code}</code>{row && <> — {row.circleName}（{row.sourceRow === 0 ? "手動新增／合併" : `來源第 ${row.sourceRow} 列`}）</>}</li>;
      })}</ul></div>
    </details>}
  </div>;
}

function OrganizerReaderPreviewPanel({ preview, venueCatalog }: { preview: OrganizerReaderPreview; venueCatalog: OrganizerVenueCatalog }) {
  const [mapIndex, setMapIndex] = useState(0);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const selected = preview.maps[mapIndex] ?? null;
  const placements = useMemo(() => selected ? preview.placements
    .filter((row) => row.dayId === selected.periodKey && row.venueSpaceId === selected.venueSpaceId) : [], [preview, selected]);
  const slots = useMemo(() => Object.fromEntries(placements.map((row) => [row.boothCode, {
    tone: "coral" as const, label: row.circleName, ariaLabel: `攤位 ${row.boothCode}，${row.circleName}`,
    selected: row.boothCode === selectedCode,
  }])), [placements, selectedCode]);
  const selectedPlacement = placements.find((row) => row.boothCode === selectedCode);
  const circlePlacements = selectedPlacement?.identityGroup
    ? preview.placements.filter(row => row.identityGroup === selectedPlacement.identityGroup) : [];
  return <div className={styles.readerPreview}>
    <p>{(preview.references ?? []).filter((record) => record.schema === "organizer/1").map((record) => record.name).join("、")}</p>
    <p>{(preview.references ?? []).filter((record) => record.schema === "venue/1" || record.schema === "venue-space/1").map((record) => record.name).join("・")}</p>
    <p>{(preview.references ?? []).flatMap((record) => record.categories?.map((category) => category.label) ?? []).join("、")}</p>
    <div className={styles.panelHead}><div><h4>{preview.event.name}</h4></div><select aria-label="選擇預覽地圖" value={mapIndex} onChange={(event) => { setMapIndex(Number(event.target.value)); setSelectedCode(null); }}>{preview.maps.map((map, index) => <option value={index} key={`${map.periodKey}/${map.venueSpaceId}`}>{organizerDayLabel(preview.event.days, map.periodKey)}{preview.venueAssignments.length > 1 ? `・${organizerVenueSpaceLabel(venueCatalog, map.venueSpaceId)}` : ""}</option>)}</select></div>
    <p className={styles.previewSelection} role="status">{selectedPlacement
      ? <><strong>{selectedPlacement.boothCode}</strong> · {selectedPlacement.circleName}</>
      : "選取攤位，核對攤位代碼與社團名稱。"}</p>
    {new Set(circlePlacements.map(row => row.dayId)).size > 1 && <ul aria-label="社團各日攤位">
      {circlePlacements.map(row => <li key={`${row.dayId}/${row.venueSpaceId}/${row.boothCode}`}>
        {organizerDayLabel(preview.event.days, row.dayId)} · {organizerVenueSpaceLabel(venueCatalog, row.venueSpaceId)} · {row.boothCode}
      </li>)}
    </ul>}
    {selected ? <AccessibleEventMapRenderer eventName={`${preview.event.name} 預覽`} layout={selected.layout} slots={slots} areaLabels={preview.venueAssignments.find((assignment) => assignment.venueSpaceId === selected.venueSpaceId)?.areaLabels} onSelect={setSelectedCode} /> : <p>尚無可預覽的地圖。</p>}
  </div>;
}
