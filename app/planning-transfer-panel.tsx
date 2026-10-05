"use client";

import { useRef, useState } from "react";
import { getCircleCatalogState } from "./circle-records";
import { PUBLISHED_EVENTS } from "./event-catalog";
import type { Locale } from "./i18n/locale";
import { useLocale, useMessages } from "./i18n/locale-context";
import { defineMessages, type MessageParams } from "./i18n/messages";
import { inspectPlanningStorage, type PlanningDocument } from "./planning-store";
import { downloadText } from "./download-text";
import { planningDayLabel } from "./planning-share-panel";
import {
  backupIssueMessage,
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

const MESSAGES = defineMessages({
  "zh-Hant": {
    backupFile: "場刊Map-規劃備份-{date}.json",
    tooLarge: "檔案超過 10 MiB，沒有復原任何資料。",
    blockedWrite: "這台裝置有無法讀取的舊資料，沒有復原任何資料。",
    changed: "這台裝置的資料在預覽後有變更，已重新計算，請再確認一次。",
    saveFailed: "無法儲存到這台裝置，原本的資料沒有變更。",
    merged: "已從備份復原：新增 {added} 筆。",
    mergedUpdated: "已從備份復原：新增 {added} 筆，更新 {updated} 筆。",
    replaced: "已用備份完整取代這台裝置的規劃資料。",
    title: "完整備份",
    intro: "包含所有活動的收藏、群組、私人備註、行程、購買項目與預算。換瀏覽器或裝置時，用「從備份復原」還原；檔案請自行保管。",
    includes: "包含 {events}。",
    blocked: "這台裝置有無法讀取的舊資料。先下載原始資料，或清除後再復原。",
    export: "匯出備份",
    restore: "從備份復原…",
    chooseFile: "選擇規劃備份檔",
    csvNote: "CSV 供試算表使用，不含活動日，不能用來還原。",
    exportCsv: "匯出 CSV",
    cannotRestore: "無法復原 {file}",
    nothingRestored: "沒有復原任何資料。",
    close: "關閉",
    previewLabel: "復原預覽",
    emptyBackup: "備份裡沒有收藏或行程。",
    newGroups: "新增 {count} 個收藏群組",
    groupClash: "群組「{incoming}」與這台裝置的「{local}」不同，會另外建立",
    conflicts: "{count} 筆兩邊內容不同",
    keepLocal: "保留這台裝置的內容",
    useIncoming: "採用備份的內容",
    allPresent: "備份內容已全部在這台裝置上。",
    confirmRestore: "確認復原",
    cancel: "取消",
    toReplace: "改為完整取代…",
    replaceTitle: "完整取代這台裝置的規劃資料",
    replaceSummary: "會移除 {favorites} 筆收藏、{plans} 筆行程、{groups} 個群組，並以備份取代 {replaced} 筆。",
    replaceEvent: "{event}：移除收藏 {favorites}、行程 {plans}；取代收藏 {replacedFavorites}、行程 {replacedPlans}",
    downloadCurrent: "先下載目前備份",
    replace: "完整取代…",
    replaceConfirm: "確定以備份取代全部規劃資料？",
    confirmReplace: "確定取代",
    back: "返回",
    counts: "新增 {new}",
    countsConflicting: "新增 {new}、內容不同 {conflicting}",
    favorites: "收藏 {total}（{counts}）",
    plans: "行程 {total}（{counts}）",
    perDay: "：{days}",
    dayCount: "{day} {count} 筆",
    notLoaded: "{count} 筆所屬活動尚未載入，會照原樣保留。",
    failed: "{count} 筆所屬活動讀取失敗，會照原樣保留。",
    unmatched: "{count} 筆目前找不到對應社團，會保留在「目前無法匹配的規劃資料」。",
  },
  en: {
    backupFile: "場刊Map-backup-{date}.json",
    tooLarge: "The file is larger than 10 MiB. Nothing was restored.",
    blockedWrite: "This device has older data that cannot be read. Nothing was restored.",
    changed: "This device's data changed after the preview. The preview was recalculated; please confirm again.",
    saveFailed: "Could not save to this device. Your existing data is unchanged.",
    merged: ({ added }) => `Restored from backup: ${added} added.`,
    mergedUpdated: ({ added, updated }) => `Restored from backup: ${added} added, ${updated} updated.`,
    replaced: "This device's planning data was fully replaced by the backup.",
    title: "Full backup",
    intro: "Includes favorites, groups, private notes, plans, items to buy and budgets for every event. When you change browser or device, use “Restore from backup”. Keep the file somewhere safe.",
    includes: "Includes {events}.",
    blocked: "This device has older data that cannot be read. Download the original data first, or clear it before restoring.",
    export: "Export backup",
    restore: "Restore from backup…",
    chooseFile: "Choose a planning backup file",
    csvNote: "CSV is for spreadsheets. It has no event days and cannot be restored.",
    exportCsv: "Export CSV",
    cannotRestore: "Cannot restore {file}",
    nothingRestored: "Nothing was restored.",
    close: "Close",
    previewLabel: "Restore preview",
    emptyBackup: "The backup has no favorites or plans.",
    newGroups: ({ count }) => count === 1 ? "Adds 1 favorite group" : `Adds ${count} favorite groups`,
    groupClash: "Group “{incoming}” differs from “{local}” on this device and will be created separately",
    conflicts: ({ count }) => count === 1 ? "1 item differs between the two" : `${count} items differ between the two`,
    keepLocal: "Keep this device's version",
    useIncoming: "Use the backup's version",
    allPresent: "Everything in the backup is already on this device.",
    confirmRestore: "Restore",
    cancel: "Cancel",
    toReplace: "Replace everything instead…",
    replaceTitle: "Replace this device's planning data",
    replaceSummary: "Removes {favorites} favorites, {plans} plan items and {groups} groups, and replaces {replaced} with the backup.",
    replaceEvent: "{event}: removes {favorites} favorites and {plans} plan items; replaces {replacedFavorites} favorites and {replacedPlans} plan items",
    downloadCurrent: "Download current backup first",
    replace: "Replace everything…",
    replaceConfirm: "Replace all planning data with the backup?",
    confirmReplace: "Replace",
    back: "Back",
    counts: "{new} new",
    countsConflicting: "{new} new, {conflicting} different",
    favorites: "Favorites {total} ({counts})",
    plans: "Plan {total} ({counts})",
    perDay: ": {days}",
    dayCount: "{day}: {count}",
    notLoaded: ({ count }) => `${count} ${count === 1 ? "item belongs" : "items belong"} to an event not loaded yet and will be kept as is.`,
    failed: ({ count }) => `${count} ${count === 1 ? "item belongs" : "items belong"} to an event that failed to load and will be kept as is.`,
    unmatched: ({ count }) => `${count} ${count === 1 ? "item has" : "items have"} no matching circle right now and will be kept under “Unmatched planning data”.`,
  },
  ja: {
    backupFile: "場刊Map-バックアップ-{date}.json",
    tooLarge: "ファイルが 10 MiB を超えています。何も復元していません。",
    blockedWrite: "この端末に読み取れない古いデータがあるため、何も復元していません。",
    changed: "プレビュー後にこの端末のデータが変更されました。再計算したので、もう一度確認してください。",
    saveFailed: "この端末に保存できませんでした。元のデータは変更されていません。",
    merged: "バックアップから復元しました：{added} 件追加。",
    mergedUpdated: "バックアップから復元しました：{added} 件追加、{updated} 件更新。",
    replaced: "この端末の保存データをバックアップで置き換えました。",
    title: "フルバックアップ",
    intro: "すべてのイベントのお気に入り、グループ、個人メモ、巡回プラン、購入メモ、予算を含みます。ブラウザや端末を変えるときは「バックアップから復元」で戻せます。ファイルはご自身で保管してください。",
    includes: "{events}を含みます。",
    blocked: "この端末に読み取れない古いデータがあります。先に元のデータをダウンロードするか、削除してから復元してください。",
    export: "バックアップを書き出す",
    restore: "バックアップから復元…",
    chooseFile: "バックアップファイルを選択",
    csvNote: "CSV は表計算ソフト用です。開催日を含まず、復元には使えません。",
    exportCsv: "CSV を書き出す",
    cannotRestore: "{file} を復元できません",
    nothingRestored: "何も復元していません。",
    close: "閉じる",
    previewLabel: "復元プレビュー",
    emptyBackup: "バックアップにお気に入りや巡回プランがありません。",
    newGroups: "お気に入りグループを {count} 件追加",
    groupClash: "グループ「{incoming}」はこの端末の「{local}」と異なるため、別に作成します",
    conflicts: "{count} 件で内容が異なります",
    keepLocal: "この端末の内容を残す",
    useIncoming: "バックアップの内容を使う",
    allPresent: "バックアップの内容はすべてこの端末にあります。",
    confirmRestore: "復元する",
    cancel: "キャンセル",
    toReplace: "すべて置き換える…",
    replaceTitle: "この端末の保存データを置き換える",
    replaceSummary: "お気に入り {favorites} 件、巡回プラン {plans} 件、グループ {groups} 件を削除し、{replaced} 件をバックアップで置き換えます。",
    replaceEvent: "{event}：お気に入り {favorites} 件・巡回プラン {plans} 件を削除、お気に入り {replacedFavorites} 件・巡回プラン {replacedPlans} 件を置き換え",
    downloadCurrent: "先に現在のバックアップをダウンロード",
    replace: "置き換える…",
    replaceConfirm: "すべての保存データをバックアップで置き換えますか？",
    confirmReplace: "置き換える",
    back: "戻る",
    counts: "{new} 件追加",
    countsConflicting: "{new} 件追加、{conflicting} 件内容が異なる",
    favorites: "お気に入り {total}（{counts}）",
    plans: "巡回プラン {total}（{counts}）",
    perDay: "：{days}",
    dayCount: "{day} {count} 件",
    notLoaded: "{count} 件はイベントをまだ読み込んでいないため、そのまま保持します。",
    failed: "{count} 件はイベントを読み込めなかったため、そのまま保持します。",
    unmatched: "{count} 件は対応するサークルが見つからないため、「一致しない保存データ」に保持します。",
  },
});
type MessageKey = keyof (typeof MESSAGES)["zh-Hant"];

const eventName = (eventId: string) => PUBLISHED_EVENTS.find((event) => event.id === eventId)?.name ?? eventId;
const listSeparator = (locale: Locale) => locale === "en" ? ", " : "、";
const catalogStatus = (eventId: string) => getCircleCatalogState(eventId).status;

/** `base` is the stored plan the preview was computed from; summary, backup and write all use it. */
type Pending = { fileName: string; text: string; preview: BackupPreview; base: PlanningDocument };
/** Kept as a message key so a language switch re-renders it. */
type Result = { kind: "ok" | "error"; key: MessageKey; params?: MessageParams } | null;

/**
 * 完整備份 (#415, ADR-0078): export the whole-browser backup, or restore from
 * one in. Nothing is written until the reader confirms a preview, and the
 * preview is recomputed when this device's data changed in between.
 */
export function PlanningTransferPanel({ eventId, document, replace, blocked }: {
  eventId: string;
  document: PlanningDocument;
  replace: (next: PlanningDocument) => boolean;
  /** Unreadable older data is being protected; importing would overwrite it. */
  blocked: boolean;
}) {
  const t = useMessages(MESSAGES);
  const { locale } = useLocale();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState<"keep" | "incoming">("keep");
  const [replacing, setReplacing] = useState<"off" | "summary" | "confirm">("off");
  const [result, setResult] = useState<Result>(null);
  const events = [...new Set([...document.favorites, ...document.visitPlans].map((item) => item.eventId))];
  const backupName = () => t("backupFile", { date: new Date().toISOString().slice(0, 10) });

  /** What is stored now. Another tab may have saved since this tab last rendered. */
  const stored = () => inspectPlanningStorage(localStorage, eventId);

  async function choose(file: File | undefined) {
    if (!file || blocked) return;
    setResult(null); setReplacing("off"); setMode("keep");
    if (file.size > MAX_BACKUP_BYTES) { setPending(null); setResult({ kind: "error", key: "tooLarge" }); return; }
    const text = await file.text();
    const base = stored().document;
    setPending({ fileName: file.name, text, base, preview: previewPlanningBackup(text, base, catalogStatus) });
  }

  function cancel() {
    setPending(null); setReplacing("off");
    if (inputRef.current) inputRef.current.value = "";
  }

  /** Writes only when this device still holds what the preview was computed from. */
  function commit(next: (incoming: PlanningDocument, current: PlanningDocument) => PlanningDocument, success: NonNullable<Result>) {
    if (!pending?.preview.ok) return;
    const latest = stored();
    if (blocked || !latest.writable) { setResult({ kind: "error", key: "blockedWrite" }); return; }
    if (planningFingerprint(latest.document) !== pending.preview.baseFingerprint) {
      setPending({ ...pending, base: latest.document, preview: previewPlanningBackup(pending.text, latest.document, catalogStatus) });
      // A choice made against the old preview must not overwrite what changed since.
      setReplacing("off"); setMode("keep");
      setResult({ kind: "error", key: "changed" });
      return;
    }
    if (replace(next(pending.preview.document, latest.document))) {
      cancel();
      setResult(success);
    } else {
      setResult({ kind: "error", key: "saveFailed" });
    }
  }

  const preview = pending?.preview;
  const conflicts = preview?.ok ? preview.events.reduce((total, event) => total + event.favorites.conflicting + event.visitPlans.conflicting, 0) : 0;
  const added = preview?.ok ? preview.events.reduce((total, event) => total + event.favorites.new + event.visitPlans.new, 0) : 0;
  const nothingNew = preview?.ok === true && added === 0 && preview.groups.new.length === 0 && preview.groups.clashes.length === 0;
  const summary = pending && preview?.ok && replacing !== "off" ? planningReplaceSummary(pending.base, preview.document) : null;

  return <section className={styles.section} id="planning-transfer" aria-labelledby="planning-transfer-title">
    <div>
      <h3 id="planning-transfer-title">{t("title")}</h3>
      <p>{t("intro")}</p>
      {events.length > 0 && <p>{t("includes", { events: events.map(eventName).join(listSeparator(locale)) })}</p>}
      {blocked && <p>{t("blocked")}</p>}
    </div>
    <div className={styles.actions}>
      <button onClick={() => downloadText(backupName(), exportPlanningJson(document), "application/json")}>{t("export")}</button>
      <button disabled={blocked} onClick={() => inputRef.current?.click()}>{t("restore")}</button>
      <input ref={inputRef} type="file" accept=".json,application/json" aria-label={t("chooseFile")} onChange={(event) => void choose(event.target.files?.[0])} />
    </div>
    <div className={styles.csvRow}>
      <span>{t("csvNote")}</span>
      <button onClick={() => downloadText("circle-plan.csv", exportPlanningCsv(document), "text/csv;charset=utf-8")}>{t("exportCsv")}</button>
    </div>

    {pending && preview && !preview.ok && <div className={styles.preview} role="alert">
      <b>{t("cannotRestore", { file: pending.fileName })}</b>
      <ul>{preview.issues.map((issue, index) => <li key={index}>{backupIssueMessage(issue, locale)}</li>)}</ul>
      <p>{t("nothingRestored")}</p>
      <button onClick={cancel}>{t("close")}</button>
    </div>}

    {pending && preview?.ok && <div className={styles.preview} aria-label={t("previewLabel")}>
      <b>{pending.fileName}</b>
      {preview.events.length === 0 && <p>{t("emptyBackup")}</p>}
      {preview.events.map((event) => <EventPreview key={event.eventId} event={event} />)}
      {(preview.groups.new.length > 0 || preview.groups.clashes.length > 0) && <ul className={styles.previewNotes}>
        {preview.groups.new.length > 0 && <li>{t("newGroups", { count: preview.groups.new.length })}</li>}
        {preview.groups.clashes.map((clash) => <li key={clash.incoming.id}>{t("groupClash", { incoming: clash.incoming.name, local: clash.local.name })}</li>)}
      </ul>}
      {conflicts > 0 && <fieldset className={styles.modeChoice}>
        <legend>{t("conflicts", { count: conflicts })}</legend>
        <label><input type="radio" name="planning-import-mode" checked={mode === "keep"} onChange={() => setMode("keep")} />{t("keepLocal")}</label>
        <label><input type="radio" name="planning-import-mode" checked={mode === "incoming"} onChange={() => setMode("incoming")} />{t("useIncoming")}</label>
      </fieldset>}
      {nothingNew && conflicts === 0 && <p>{t("allPresent")}</p>}
      {replacing === "off" && <div className={styles.confirmActions}>
        <button className={styles.primary} disabled={nothingNew && (conflicts === 0 || mode === "keep")} onClick={() => commit((incoming, current) => mergePlanningBackup(current, incoming, mode), conflicts > 0 && mode === "incoming" ? { kind: "ok", key: "mergedUpdated", params: { added, updated: conflicts } } : { kind: "ok", key: "merged", params: { added } })}>{t("confirmRestore")}</button>
        <button onClick={cancel}>{t("cancel")}</button>
        <button className={styles.linkButton} onClick={() => setReplacing("summary")}>{t("toReplace")}</button>
      </div>}
      {summary && <div className={styles.replacePanel}>
        <b>{t("replaceTitle")}</b>
        <p>{t("replaceSummary", { favorites: summary.totals.favorites.removed, plans: summary.totals.visitPlans.removed, groups: summary.totals.groups.removed, replaced: summary.totals.favorites.replaced + summary.totals.visitPlans.replaced })}</p>
        {summary.events.length > 0 && <ul className={styles.previewNotes}>{summary.events.map((item) => <li key={item.eventId}>{t("replaceEvent", { event: eventName(item.eventId), favorites: item.favorites.removed, plans: item.visitPlans.removed, replacedFavorites: item.favorites.replaced, replacedPlans: item.visitPlans.replaced })}</li>)}</ul>}
        <div className={styles.confirmActions}>
          <button onClick={() => downloadText(backupName(), exportPlanningJson(pending.base), "application/json")}>{t("downloadCurrent")}</button>
          {replacing === "summary"
            ? <button className={styles.dangerButton} onClick={() => setReplacing("confirm")}>{t("replace")}</button>
            : <><span className={styles.confirmText}>{t("replaceConfirm")}</span><button className={styles.dangerButton} onClick={() => commit((incoming) => incoming, { kind: "ok", key: "replaced" })}>{t("confirmReplace")}</button></>}
          <button onClick={() => setReplacing("off")}>{t("back")}</button>
        </div>
      </div>}
    </div>}

    {result && <p className={result.kind === "error" ? styles.errorText : styles.okText} role={result.kind === "error" ? "alert" : "status"}>{t(result.key, result.params)}</p>}
  </section>;
}

function EventPreview({ event }: { event: BackupEventPreview }) {
  const t = useMessages(MESSAGES);
  const { locale } = useLocale();
  const counts = (value: { new: number; conflicting: number }) => value.conflicting ? t("countsConflicting", { new: value.new, conflicting: value.conflicting }) : t("counts", { new: value.new });
  const days = Object.entries(event.visitPlans.perDay);
  const { notLoaded, failed, unmatched } = event.unresolved;
  return <div className={styles.eventPreview}>
    <b>{eventName(event.eventId)}</b>
    <span>{t("favorites", { total: event.favorites.total, counts: counts(event.favorites) })}</span>
    <span>{t("plans", { total: event.visitPlans.total, counts: counts(event.visitPlans) })}{days.length > 0 && t("perDay", { days: days.map(([day, count]) => t("dayCount", { day: planningDayLabel(event.eventId, day, locale), count })).join(listSeparator(locale)) })}</span>
    {notLoaded.total > 0 && <small>{t("notLoaded", { count: notLoaded.total })}</small>}
    {failed.total > 0 && <small>{t("failed", { count: failed.total })}</small>}
    {unmatched.total > 0 && <small>{t("unmatched", { count: unmatched.total })}</small>}
  </div>;
}
