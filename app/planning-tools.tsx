"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isKnownCircleId } from "./circle-records";
import { PUBLISHED_EVENTS } from "./event-catalog";
import { formatTwd } from "./i18n/format";
import { useLocale, useMessages } from "./i18n/locale-context";
import { defineMessages, type MessageParams } from "./i18n/messages";
import { useCircleCatalog } from "./use-circle-catalog";
import { EMPTY_PLANNING_DOCUMENT, deleteFavoriteGroup, moveFavoriteGroup, moveFavoritesToGroup, removeFromVisitPlan, toggleFavorite, updateFavoriteGroup } from "./planning-store";
import { PlanningTransferPanel } from "./planning-transfer-panel";
import { downloadText } from "./download-text";
import { SharedItineraryDialog } from "./planning-share-panel";
import { ReaderPlanningBoundary, useReaderPlanning } from "./reader-planning";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import styles from "./planning-tools.module.css";

const MESSAGES = defineMessages({
  "zh-Hant": {
    launcher: "資料管理",
    title: "規劃資料管理",
    close: "關閉規劃資料管理",
    ready: "資料僅儲存於瀏覽器，您可以匯出備份。",
    loading: "正在讀取瀏覽器資料",
    protected: "原始規劃資料受到保護",
    rawFile: "場刊Map-原始規劃資料.json",
    downloadRaw: "先下載原始資料",
    favorites: "收藏",
    memos: "備註",
    plans: "行程項目",
    groups: "群組",
    groupTitle: "收藏群組管理",
    groupIntro: "刪除群組前，請選擇收藏的移動位置。",
    noGroups: "尚未建立群組。",
    groupName: "{name} 群組名稱",
    groupColor: "{name} 群組顏色",
    coral: "珊瑚", mint: "薄荷", blue: "藍", amber: "琥珀", lilac: "紫",
    groupUp: "{name} 群組往前移",
    groupDown: "{name} 群組往後移",
    deleteTarget: "刪除 {name} 時的移動目標",
    toUngrouped: "移到未分組",
    toGroup: "移到 {name}",
    confirmDelete: "刪除「{name}」並移動其中 {count} 筆收藏？",
    delete: "刪除",
    batchSource: "批次來源",
    allFavorites: "全部收藏",
    ungrouped: "未分組",
    moveTo: "移動到",
    moved: "已移動 {count} 筆收藏。",
    move: "移動 {count} 筆",
    orphanTitle: "目前無法匹配的規劃資料",
    orphanIntro: "社團可能已取消、移動或不在目前場刊；備註、行程與購物規劃會保留，您仍可匯出或逐筆移除。",
    orphanFavorite: "收藏",
    orphanMemo: " · 備註：{memo}",
    next: "下一站",
    visited: "已走訪",
    planned: "待前往",
    removeFavorite: "移除收藏",
    removePlan: "移除行程",
    clearTitle: "清除所有規劃資料",
    clearSummary: "會移除 {favorites} 筆收藏、{memos} 筆備註、{plans} 筆行程與 {groups} 個群組。",
    clearUnsupported: "也會刪除無法讀取的舊資料。",
    clearConfirm: "確定要永久清除這台裝置上的資料？",
    confirmClear: "確定清除",
    cancel: "取消",
    clear: "清除資料…",
    cleared: "已清除所有規劃資料。",
    clearFailed: "無法儲存到這台裝置，資料沒有清除。",
  },
  en: {
    launcher: "Manage data",
    title: "Manage planning data",
    close: "Close planning data",
    ready: "Data is stored only in this browser. You can export a backup.",
    loading: "Reading browser data",
    protected: "Original planning data is protected",
    rawFile: "場刊Map-original-planning-data.json",
    downloadRaw: "Download original data first",
    favorites: "Favorites",
    memos: "Notes",
    plans: "Plan items",
    groups: "Groups",
    groupTitle: "Favorite groups",
    groupIntro: "Before deleting a group, choose where its favorites go.",
    noGroups: "No groups yet.",
    groupName: "{name} group name",
    groupColor: "{name} group color",
    coral: "Coral", mint: "Mint", blue: "Blue", amber: "Amber", lilac: "Lilac",
    groupUp: "Move {name} group up",
    groupDown: "Move {name} group down",
    deleteTarget: "Where favorites go when {name} is deleted",
    toUngrouped: "Move to ungrouped",
    toGroup: "Move to {name}",
    confirmDelete: ({ name, count }) => `Delete “${name}” and move its ${count === 1 ? "1 favorite" : `${count} favorites`}?`,
    delete: "Delete",
    batchSource: "Move from",
    allFavorites: "All favorites",
    ungrouped: "Ungrouped",
    moveTo: "Move to",
    moved: ({ count }) => count === 1 ? "Moved 1 favorite." : `Moved ${count} favorites.`,
    move: "Move {count}",
    orphanTitle: "Unmatched planning data",
    orphanIntro: "The circle may have cancelled, moved or is not in the current catalog. Notes, plans and shopping plans are kept; you can still export them or remove them one by one.",
    orphanFavorite: "Favorite",
    orphanMemo: " · Note: {memo}",
    next: "Next stop",
    visited: "Visited",
    planned: "To visit",
    removeFavorite: "Remove favorite",
    removePlan: "Remove from plan",
    clearTitle: "Clear all planning data",
    clearSummary: "Removes {favorites} favorites, {memos} notes, {plans} plan items and {groups} groups.",
    clearUnsupported: " Older data that cannot be read is deleted too.",
    clearConfirm: "Permanently clear the data on this device?",
    confirmClear: "Clear",
    cancel: "Cancel",
    clear: "Clear data…",
    cleared: "All planning data was cleared.",
    clearFailed: "Could not save to this device. Nothing was cleared.",
  },
  ja: {
    launcher: "データ管理",
    title: "保存データの管理",
    close: "保存データの管理を閉じる",
    ready: "データはこのブラウザにのみ保存されます。バックアップを書き出せます。",
    loading: "ブラウザのデータを読み込んでいます",
    protected: "元の保存データを保護しています",
    rawFile: "場刊Map-元の保存データ.json",
    downloadRaw: "先に元のデータをダウンロード",
    favorites: "お気に入り",
    memos: "メモ",
    plans: "巡回プラン",
    groups: "グループ",
    groupTitle: "お気に入りグループの管理",
    groupIntro: "グループを削除する前に、お気に入りの移動先を選んでください。",
    noGroups: "グループはまだありません。",
    groupName: "{name} のグループ名",
    groupColor: "{name} のグループの色",
    coral: "コーラル", mint: "ミント", blue: "ブルー", amber: "アンバー", lilac: "ライラック",
    groupUp: "{name} グループを上へ移動",
    groupDown: "{name} グループを下へ移動",
    deleteTarget: "{name} を削除するときの移動先",
    toUngrouped: "未分類へ移動",
    toGroup: "{name} へ移動",
    confirmDelete: "「{name}」を削除し、中のお気に入り {count} 件を移動しますか？",
    delete: "削除",
    batchSource: "移動元",
    allFavorites: "すべてのお気に入り",
    ungrouped: "未分類",
    moveTo: "移動先",
    moved: "お気に入り {count} 件を移動しました。",
    move: "{count} 件を移動",
    orphanTitle: "一致しない保存データ",
    orphanIntro: "サークルが参加を取り消したか、移動したか、現在のカタログにない可能性があります。メモ、巡回プラン、購入メモは保持されるので、書き出すか 1 件ずつ削除できます。",
    orphanFavorite: "お気に入り",
    orphanMemo: " · メモ：{memo}",
    next: "次に行く",
    visited: "訪問済み",
    planned: "未訪問",
    removeFavorite: "お気に入りから削除",
    removePlan: "巡回プランから削除",
    clearTitle: "すべての保存データを削除",
    clearSummary: "お気に入り {favorites} 件、メモ {memos} 件、巡回プラン {plans} 件、グループ {groups} 件を削除します。",
    clearUnsupported: "読み取れない古いデータも削除されます。",
    clearConfirm: "この端末のデータを完全に削除しますか？",
    confirmClear: "削除する",
    cancel: "キャンセル",
    clear: "データを削除…",
    cleared: "すべての保存データを削除しました。",
    clearFailed: "この端末に保存できなかったため、データは削除されていません。",
  },
});
type MessageKey = keyof (typeof MESSAGES)["zh-Hant"];
const GROUP_COLORS = ["coral", "mint", "blue", "amber", "lilac"] as const;

export default function PlanningTools({ eventId }: { eventId: string }) {
  const catalog = useCircleCatalog(eventId);
  return <ReaderPlanningBoundary eventId={eventId} settled={catalog.status !== "loading"}><PlanningToolsContent eventId={eventId} /></ReaderPlanningBoundary>;
}
function PlanningToolsContent({ eventId }: { eventId: string }) {
  // Subscribe to the catalog so orphan detection re-runs once records arrive,
  // instead of reporting every favorite as unmatched while the snapshot loads.
  const { document, ready, update, replace, storageError, unsupportedRaw } = useReaderPlanning();
  const t = useMessages(MESSAGES);
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  // A message key, so a language switch re-renders the notice instead of keeping old words.
  const [notice, setNotice] = useState<{ key: MessageKey; params?: MessageParams } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [groupTargets, setGroupTargets] = useState<Record<string, string>>( {} );
  const [batchSource, setBatchSource] = useState<string>("ALL");
  const [batchTarget, setBatchTarget] = useState<string>("");
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalFocus(open, dialogRef, () => setOpen(false));
  const memoCount = document.favorites.filter((item) => item.memo.trim()).length;
  const batchSourceId = batchSource === "ALL" ? "ALL" : batchSource || null;
  const batchCount = document.favorites.filter((favorite) => favorite.eventId === eventId && (batchSourceId === "ALL" || favorite.groupId === batchSourceId)).length;
  // Records of events this site does not publish cannot be opened anywhere
  // else, so they are managed here too (#415): an imported backup can bring them.
  const unpublished = (id: string) => !PUBLISHED_EVENTS.some((event) => event.id === id);
  const orphaned = (item: { eventId: string; circleId: string }) => item.eventId === eventId ? !isKnownCircleId(item.circleId, item.eventId) : unpublished(item.eventId);
  const orphanFavorites = document.favorites.filter(orphaned);
  const orphanPlans = document.visitPlans.filter(orphaned);
  const orphanLabel = (item: { eventId: string; circleId: string }) => item.eventId === eventId ? item.circleId : `${item.eventId} · ${item.circleId}`;

  return <>
    <button className={styles.launcher} onClick={() => setOpen(true)}>{t("launcher")}</button>
    {ready && <SharedItineraryDialog eventId={eventId} update={update} blocked={Boolean(unsupportedRaw)} />}
    {open && createPortal(<div className={styles.backdrop} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="planning-tools-title" tabIndex={-1}>
      <header><div><h2 id="planning-tools-title">{t("title")}</h2></div><button onClick={() => setOpen(false)} aria-label={t("close")}><UiIcon name="close" /></button></header>
      <p className={styles.notice} role="status">{ready ? t("ready") : t("loading")}</p>
      {storageError && <div className={styles.preview} role="alert"><b>{t("protected")}</b><p>{storageError}</p>{unsupportedRaw && <button onClick={() => downloadText(t("rawFile"), unsupportedRaw, "application/json")}>{t("downloadRaw")}</button>}</div>}
      <div className={styles.summary}><span><b>{document.favorites.length}</b> {t("favorites")}</span><span><b>{memoCount}</b> {t("memos")}</span><span><b>{document.visitPlans.length}</b> {t("plans")}</span><span><b>{document.favoriteGroups.length}</b> {t("groups")}</span></div>
      {ready && <PlanningTransferPanel eventId={eventId} document={document} replace={replace} blocked={Boolean(unsupportedRaw)} />}
      <section className={styles.section}><div><h3>{t("groupTitle")}</h3><p>{t("groupIntro")}</p></div>{document.favoriteGroups.length === 0 ? <small>{t("noGroups")}</small> : <div className={styles.groupList}>{document.favoriteGroups.map((group, index) => <div key={group.id} className={styles.groupRow}>
        <input aria-label={t("groupName", { name: group.name })} defaultValue={group.name} onBlur={(event) => update((current) => updateFavoriteGroup(current, group.id, { name: event.target.value }))} />
        <select aria-label={t("groupColor", { name: group.name })} value={group.color} onChange={(event) => update((current) => updateFavoriteGroup(current, group.id, { color: event.target.value }))}>{GROUP_COLORS.map((color) => <option key={color} value={color}>{t(color)}</option>)}</select>
        <button disabled={index === 0} onClick={() => update((current) => moveFavoriteGroup(current, group.id, -1))} aria-label={t("groupUp", { name: group.name })}><UiIcon name="arrow-up" /></button><button disabled={index === document.favoriteGroups.length - 1} onClick={() => update((current) => moveFavoriteGroup(current, group.id, 1))} aria-label={t("groupDown", { name: group.name })}><UiIcon name="arrow-down" /></button>
        <select aria-label={t("deleteTarget", { name: group.name })} value={groupTargets[group.id] ?? ""} onChange={(event) => setGroupTargets({ ...groupTargets, [group.id]: event.target.value })}><option value="">{t("toUngrouped")}</option>{document.favoriteGroups.filter((item) => item.id !== group.id).map((item) => <option key={item.id} value={item.id}>{t("toGroup", { name: item.name })}</option>)}</select>
        <button onClick={() => { const count = document.favorites.filter((favorite) => favorite.groupId === group.id).length; if (window.confirm(t("confirmDelete", { name: group.name, count }))) update((current) => deleteFavoriteGroup(current, group.id, groupTargets[group.id] || null)); }}>{t("delete")}</button>
      </div>)}<div className={styles.batchRow}><label>{t("batchSource")}<select value={batchSource} onChange={(event) => setBatchSource(event.target.value)}><option value="ALL">{t("allFavorites")}</option><option value="">{t("ungrouped")}</option>{document.favoriteGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>{t("moveTo")}<select value={batchTarget} onChange={(event) => setBatchTarget(event.target.value)}><option value="">{t("ungrouped")}</option>{document.favoriteGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><button disabled={batchCount === 0 || batchSourceId === (batchTarget || null)} onClick={() => { update((current) => moveFavoritesToGroup(current, eventId, batchSourceId, batchTarget || null)); setNotice({ key: "moved", params: { count: batchCount } }); }}>{t("move", { count: batchCount })}</button></div></div>}</section>
      {(orphanFavorites.length > 0 || orphanPlans.length > 0) && <section className={styles.section}><div><h3>{t("orphanTitle")}</h3><p>{t("orphanIntro")}</p></div><div className={styles.orphanList}>{orphanFavorites.map((favorite) => <div key={`favorite-${favorite.eventId}-${favorite.circleId}`}><span><b>{orphanLabel(favorite)}</b><small>{t("orphanFavorite")}{favorite.memo ? t("orphanMemo", { memo: favorite.memo }) : ""}</small></span><button onClick={() => update((current) => toggleFavorite(current, favorite.eventId, favorite.circleId))}>{t("removeFavorite")}</button></div>)}{orphanPlans.map((entry) => <div key={`plan-${entry.eventId}-${entry.day}-${entry.circleId}`}><span><b>{orphanLabel(entry)}</b><small>DAY {entry.day} · {entry.status === "next" ? t("next") : entry.status === "visited" ? t("visited") : t("planned")}{entry.purchaseMemo ? ` · ${entry.purchaseMemo}` : ""}{entry.budget !== null ? ` · ${formatTwd(entry.budget, locale)}` : ""}</small></span><button onClick={() => update((current) => removeFromVisitPlan(current, entry.eventId, entry.day, entry.circleId))}>{t("removePlan")}</button></div>)}</div></section>}
      <section className={`${styles.section} ${styles.danger}`}><div><h3>{t("clearTitle")}</h3><p>{t("clearSummary", { favorites: document.favorites.length, memos: memoCount, plans: document.visitPlans.length, groups: document.favoriteGroups.length })}{unsupportedRaw && t("clearUnsupported")}</p></div>{confirmClear ? <div className={styles.confirmRow}><span>{t("clearConfirm")}</span><button onClick={() => { setConfirmClear(false); setNotice({ key: replace(EMPTY_PLANNING_DOCUMENT) ? "cleared" : "clearFailed" }); }}>{t("confirmClear")}</button><button onClick={() => setConfirmClear(false)}>{t("cancel")}</button></div> : <button onClick={() => setConfirmClear(true)}>{t("clear")}</button>}</section>
      {notice && <p className={styles.notice} role="status">{t(notice.key, notice.params)}</p>}
    </section></div>, globalThis.document.body)}
  </>;
}
