/** 檢查與預覽：驗證問題卡與 Reader 預覽。
 *
 * 由 `organizer-app.tsx` 拆出（#224）。該檔原本是 1870 行的單檔，面板
 * 彼此無關卻共處一室，讀一個面板要先略過另外四個。
 */
import AccessibleEventMapRenderer from "../accessible-event-map-renderer";
import { previewOrganizerEvent, validateOrganizerEvent, type OrganizerEventDetail, type OrganizerReaderPreview } from "../organizer-client";
import { type OrganizerValidationIssue } from "../organizer-event";
import { type OrganizerVenueCatalog } from "../organizer-venue-catalog";
import { STEP_LABEL, organizerDayLabel, organizerIssueMessage, organizerVenueSpaceLabel } from "./organizer-shared";
import styles from "./organizer.module.css";
import { ActionNotice, useActionFeedback } from "./organizer-feedback";
import { useMemo, useRef, useState } from "react";

export function ValidationPanel({ detail, onChanged }: { detail: OrganizerEventDetail; onChanged: () => Promise<void> }) {
  const [issues, setIssues] = useState<OrganizerValidationIssue[] | null>(null);
  const [preview, setPreview] = useState<OrganizerReaderPreview | null>(null);
  const checkFeedback = useActionFeedback();
  const previewFeedback = useActionFeedback();
  // The preview renders below a list that is often longer than the screen, so
  // without this the button looked like it did nothing (#220 decision 4).
  const previewRef = useRef<HTMLDivElement | null>(null);
  const grouped = useMemo(() => issues ? { errors: issues.filter((issue) => issue.severity === "error"), warnings: issues.filter((issue) => issue.severity === "warning") } : null, [issues]);
  return <section className={styles.panel}>
    <div className={styles.panelHead}><div><h3>檢查與預覽</h3><p>預覽只有登入後看得到，不會公開。</p></div><div className={styles.row}>
      <button type="button" disabled={checkFeedback.pending} onClick={() => void checkFeedback.run(validateOrganizerEvent(detail.event.id).then(async (result) => { setIssues(result.issues); await onChanged(); }), "檢查完成。")}>執行檢查</button>
      <button type="button" className={styles.ghost} disabled={previewFeedback.pending} onClick={() => void previewFeedback.run(previewOrganizerEvent(detail.event.id).then((result) => { setIssues(result.issues); setPreview(result.preview); }), "預覽已產生。").then((ok) => { if (ok) previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); })}>建立預覽</button>
    </div><ActionNotice notice={checkFeedback.notice} /><ActionNotice notice={previewFeedback.notice} /></div>
    {grouped && <div className={styles.validationSummary}><b>{grouped.errors.length} 項必須修正</b><span>{grouped.warnings.length} 項建議確認</span></div>}
    {issues?.map((issue, index) => <OrganizerValidationIssueCard key={`${issue.code}-${index}`} issue={issue} detail={detail} />)}
    <div ref={previewRef}>{preview !== null && <OrganizerReaderPreviewPanel preview={preview} venueCatalog={detail.venueCatalog} />}</div>
  </section>;
}

export function OrganizerValidationIssueCard({ issue, detail }: { issue: OrganizerValidationIssue; detail: OrganizerEventDetail }) {
  const amendment = detail.event.operation === "AMEND";
  const [dayId, venueSpaceId] = issue.step === "map" ? (issue.target ?? "").split("/") : [];
  const scopeLabel = dayId && venueSpaceId
    ? `${organizerDayLabel(detail.draft.event.days, dayId)}・${organizerVenueSpaceLabel(detail.venueCatalog, venueSpaceId)}` : null;
  const unknown = issue.step === "map" && issue.code === "unknown_booth";
  const missing = issue.step === "map" && issue.code === "missing_booth";
  const rows = detail.import?.rows.filter((row) => row.dayId === dayId && row.venueSpaceId === venueSpaceId) ?? [];
  const rowsByCode = new Map(rows.flatMap((row) => row.codes.map((code) => [code, row] as const)));
  const description = unknown
    ? `地圖有 ${issue.boothCodes?.length ?? "部分"} 個攤位代碼未出現在同一天、同一場館空間的匯入資料。`
    : missing ? `匯入資料有 ${issue.boothCodes?.length ?? "部分"} 個攤位代碼未出現在這份地圖。`
      : organizerIssueMessage(issue, detail.venueCatalog, detail.draft);
  return <div className={issue.severity === "error" ? styles.issueError : styles.issueWarning}>
    <p><b>{issue.severity === "error" ? "必須修正" : "建議確認"}・{STEP_LABEL[issue.step]}</b>{scopeLabel && <>・{scopeLabel}</>}<br />{description}</p>
    {(unknown || missing) && <>
      <p>比對來源：已儲存的地圖 ↔ {detail.import ? `${detail.import.source.fileName}${detail.import.source.worksheet ? `／工作表「${detail.import.source.worksheet}」` : ""}` : "尚無匯入資料"}（此活動日與場館空間共 {rows.length} 筆匯入資料）。</p>
      <p>{amendment ? "請到「地圖」對照修正後的攤位位置與代碼；若修正宣告有誤，請到「名單修正」調整並儲存。未分配給社團的空攤位可以保留。" : unknown
        ? "請到「地圖」對照主辦配置圖，確認代碼是否打錯；也請到「攤位匯入」檢查活動日、場館空間與攤位代碼的欄位對應。若確定是未分配給社團的空攤位，可保留，不影響送審。"
        : "請到「地圖」確認是否漏畫攤位或代碼不同（例如 A1 與 A01）；若匯入資料的日期、場館空間或代碼有誤，請到「攤位匯入」修正後重新儲存。"}</p>
      <p>修正並儲存後，請重新執行檢查。</p>
    </>}
    {!!issue.boothCodes?.length && <details>
      <summary>查看全部 {issue.boothCodes.length} 個攤位代碼{missing ? "與匯入資料列" : ""}</summary>
      <div className={styles.validationCodes}><ul>{issue.boothCodes.map((code) => {
        const row = rowsByCode.get(code);
        return <li key={code}><code>{code}</code>{row && <> — {row.circleName}（來源第 {row.sourceRow} 列）</>}</li>;
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
  return <div className={styles.readerPreview}>
    <p>{(preview.references ?? []).filter((record) => record.schema === "organizer/1").map((record) => record.name).join("、")}</p>
    <p>{(preview.references ?? []).filter((record) => record.schema === "venue/1" || record.schema === "venue-space/1").map((record) => record.name).join("・")}</p>
    <p>{(preview.references ?? []).flatMap((record) => record.categories?.map((category) => category.label) ?? []).join("、")}</p>
    <div className={styles.panelHead}><div><p className={styles.contextLine}>登入後預覽</p><h4>{preview.event.name}</h4></div><select aria-label="選擇預覽地圖" value={mapIndex} onChange={(event) => { setMapIndex(Number(event.target.value)); setSelectedCode(null); }}>{preview.maps.map((map, index) => <option value={index} key={`${map.periodKey}/${map.venueSpaceId}`}>{organizerDayLabel(preview.event.days, map.periodKey)}{preview.venueAssignments.length > 1 ? `・${organizerVenueSpaceLabel(venueCatalog, map.venueSpaceId)}` : ""}</option>)}</select></div>
    <p className={styles.previewSelection} role="status">{selectedPlacement
      ? <><strong>{selectedPlacement.boothCode}</strong> · {selectedPlacement.circleName}</>
      : "選取攤位，核對攤位代碼與社團名稱。"}</p>
    {selected ? <AccessibleEventMapRenderer eventName={`${preview.event.name} 預覽`} layout={selected.layout} slots={slots} onSelect={setSelectedCode} /> : <p>尚無可預覽的地圖。</p>}
    <details><summary>檢視資料明細</summary><pre className={styles.preview}>{JSON.stringify(preview, null, 2)}</pre></details>
  </div>;
}
