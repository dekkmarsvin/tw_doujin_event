"use client";

import { useRef, useState } from "react";
import { getCircleCatalogState } from "./circle-records";
import { PUBLISHED_EVENTS } from "./event-catalog";
import type { PlanningDocument } from "./planning-store";
import {
  exportPlanningCsv,
  exportPlanningJson,
  mergePlanningBackup,
  planningFingerprint,
  planningReplaceSummary,
  previewPlanningBackup,
  type BackupEventPreview,
  type BackupPreview,
} from "./planning-transfer";
import styles from "./planning-tools.module.css";

/** Same limit the parser enforces; checked first so a huge file is never read into memory. */
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const backupName = () => `場刊Map-規劃備份-${new Date().toISOString().slice(0, 10)}.json`;
const eventName = (eventId: string) => PUBLISHED_EVENTS.find((event) => event.id === eventId)?.name ?? eventId;
function dayName(eventId: string, day: string) {
  const found = PUBLISHED_EVENTS.find((event) => event.id === eventId)?.days.find((item) => String(item.id) === day);
  return found ? `${found.label}（${found.dateLabel}）` : `DAY ${day}`;
}
const catalogStatus = (eventId: string) => getCircleCatalogState(eventId).status;

type Pending = { fileName: string; text: string; preview: BackupPreview };
type Result = { kind: "ok" | "error"; message: string } | null;

/**
 * 帶到另一台裝置 (#415, ADR-0078): download the whole-browser backup, or bring
 * one in. Nothing is written until the reader confirms a preview, and the
 * preview is recomputed when this device's data changed in between.
 */
export function PlanningTransferPanel({ document, replace }: { document: PlanningDocument; replace: (next: PlanningDocument) => boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState<"keep" | "incoming">("keep");
  const [replacing, setReplacing] = useState<"off" | "summary" | "confirm">("off");
  const [result, setResult] = useState<Result>(null);
  const events = [...new Set([...document.favorites, ...document.visitPlans].map((item) => item.eventId))];

  async function choose(file: File | undefined) {
    if (!file) return;
    setResult(null); setReplacing("off"); setMode("keep");
    if (file.size > MAX_BACKUP_BYTES) { setPending(null); setResult({ kind: "error", message: "檔案超過 10 MiB，沒有匯入任何資料。" }); return; }
    const text = await file.text();
    setPending({ fileName: file.name, text, preview: previewPlanningBackup(text, document, catalogStatus) });
  }

  function cancel() {
    setPending(null); setReplacing("off");
    if (inputRef.current) inputRef.current.value = "";
  }

  /** Writes only when this device still holds what the preview was computed from. */
  function commit(next: (incoming: PlanningDocument) => PlanningDocument, success: string) {
    if (!pending?.preview.ok) return;
    if (planningFingerprint(document) !== pending.preview.baseFingerprint) {
      setPending({ ...pending, preview: previewPlanningBackup(pending.text, document, catalogStatus) });
      // A choice made against the old preview must not overwrite what changed since.
      setReplacing("off"); setMode("keep");
      setResult({ kind: "error", message: "這台裝置的資料在預覽後有變更，已重新計算，請再確認一次。" });
      return;
    }
    if (replace(next(pending.preview.document))) {
      cancel();
      setResult({ kind: "ok", message: success });
    } else {
      setResult({ kind: "error", message: "無法儲存到這台裝置，原本的資料沒有變更。" });
    }
  }

  const preview = pending?.preview;
  const conflicts = preview?.ok ? preview.events.reduce((total, event) => total + event.favorites.conflicting + event.visitPlans.conflicting, 0) : 0;
  const added = preview?.ok ? preview.events.reduce((total, event) => total + event.favorites.new + event.visitPlans.new, 0) : 0;
  const nothingNew = preview?.ok === true && added === 0 && preview.groups.new.length === 0 && preview.groups.clashes.length === 0;
  const summary = preview?.ok && replacing !== "off" ? planningReplaceSummary(document, preview.document) : null;

  return <section className={styles.section} id="planning-transfer" aria-labelledby="planning-transfer-title">
    <div>
      <h3 id="planning-transfer-title">帶到另一台裝置</h3>
      <p>下載完整備份，再到另一台裝置的「資料管理」匯入。備份含私人備註與預算，請自行保管。</p>
      {events.length > 0 && <p>包含 {events.map(eventName).join("、")}。</p>}
    </div>
    <div className={styles.actions}>
      <button onClick={() => downloadText(backupName(), exportPlanningJson(document), "application/json")}>下載完整備份</button>
      <button onClick={() => inputRef.current?.click()}>匯入計畫…</button>
      <input ref={inputRef} type="file" accept=".json,application/json" aria-label="選擇規劃備份檔" onChange={(event) => void choose(event.target.files?.[0])} />
    </div>
    <div className={styles.csvRow}>
      <span>CSV 供試算表使用，不含活動日，不能用來還原。</span>
      <button onClick={() => downloadText("circle-plan.csv", exportPlanningCsv(document), "text/csv;charset=utf-8")}>匯出 CSV</button>
    </div>

    {pending && preview && !preview.ok && <div className={styles.preview} role="alert">
      <b>無法匯入 {pending.fileName}</b>
      <ul>{preview.errors.map((error) => <li key={error}>{error}</li>)}</ul>
      <p>沒有匯入任何資料。</p>
      <button onClick={cancel}>關閉</button>
    </div>}

    {pending && preview?.ok && <div className={styles.preview} aria-label="匯入預覽">
      <b>{pending.fileName}</b>
      {preview.events.length === 0 && <p>備份裡沒有收藏或行程。</p>}
      {preview.events.map((event) => <EventPreview key={event.eventId} event={event} />)}
      {(preview.groups.new.length > 0 || preview.groups.clashes.length > 0) && <ul className={styles.previewNotes}>
        {preview.groups.new.length > 0 && <li>新增 {preview.groups.new.length} 個收藏群組</li>}
        {preview.groups.clashes.map((clash) => <li key={clash.incoming.id}>群組「{clash.incoming.name}」與這台裝置的「{clash.local.name}」不同，會另外建立</li>)}
      </ul>}
      {conflicts > 0 && <fieldset className={styles.modeChoice}>
        <legend>{conflicts} 筆兩邊內容不同</legend>
        <label><input type="radio" name="planning-import-mode" checked={mode === "keep"} onChange={() => setMode("keep")} />保留這台裝置的內容</label>
        <label><input type="radio" name="planning-import-mode" checked={mode === "incoming"} onChange={() => setMode("incoming")} />採用備份的內容</label>
      </fieldset>}
      {nothingNew && conflicts === 0 && <p>備份內容已全部在這台裝置上。</p>}
      {replacing === "off" && <div className={styles.confirmActions}>
        <button className={styles.primary} disabled={nothingNew && (conflicts === 0 || mode === "keep")} onClick={() => commit((incoming) => mergePlanningBackup(document, incoming, mode), `已匯入：新增 ${added} 筆${conflicts > 0 && mode === "incoming" ? `，更新 ${conflicts} 筆` : ""}。`)}>確認匯入</button>
        <button onClick={cancel}>取消</button>
        <button className={styles.linkButton} onClick={() => setReplacing("summary")}>改為完整取代…</button>
      </div>}
      {summary && <div className={styles.replacePanel}>
        <b>完整取代這台裝置的規劃資料</b>
        <p>會移除 {summary.totals.favorites.removed} 筆收藏、{summary.totals.visitPlans.removed} 筆行程、{summary.totals.groups.removed} 個群組，並以備份取代 {summary.totals.favorites.replaced + summary.totals.visitPlans.replaced} 筆。</p>
        {summary.events.length > 0 && <ul className={styles.previewNotes}>{summary.events.map((item) => <li key={item.eventId}>{eventName(item.eventId)}：移除收藏 {item.favorites.removed}、行程 {item.visitPlans.removed}</li>)}</ul>}
        <div className={styles.confirmActions}>
          <button onClick={() => downloadText(backupName(), exportPlanningJson(document), "application/json")}>先下載目前備份</button>
          {replacing === "summary"
            ? <button className={styles.dangerButton} onClick={() => setReplacing("confirm")}>完整取代…</button>
            : <><span className={styles.confirmText}>確定以備份取代全部規劃資料？</span><button className={styles.dangerButton} onClick={() => commit((incoming) => incoming, "已用備份完整取代這台裝置的規劃資料。")}>確定取代</button></>}
          <button onClick={() => setReplacing("off")}>返回</button>
        </div>
      </div>}
    </div>}

    {result && <p className={result.kind === "error" ? styles.errorText : styles.okText} role={result.kind === "error" ? "alert" : "status"}>{result.message}</p>}
  </section>;
}

function EventPreview({ event }: { event: BackupEventPreview }) {
  const days = Object.entries(event.visitPlans.perDay);
  const { notLoaded, failed, unmatched } = event.unresolved;
  return <div className={styles.eventPreview}>
    <b>{eventName(event.eventId)}</b>
    <span>收藏 {event.favorites.total}（新增 {event.favorites.new}）</span>
    <span>行程 {event.visitPlans.total}（新增 {event.visitPlans.new}）{days.length > 0 && `：${days.map(([day, count]) => `${dayName(event.eventId, day)} ${count} 筆`).join("、")}`}</span>
    {notLoaded.total > 0 && <small>{notLoaded.total} 筆所屬活動尚未載入，會照原樣保留。</small>}
    {failed.total > 0 && <small>{failed.total} 筆所屬活動讀取失敗，會照原樣保留。</small>}
    {unmatched.total > 0 && <small>{unmatched.total} 筆目前找不到對應社團，會保留在「目前無法匹配的規劃資料」。</small>}
  </div>;
}
