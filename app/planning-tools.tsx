"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ACTIVE_EVENT_ID } from "./event-catalog";
import { isKnownCircleId } from "./circle-records";
import { useCircleCatalog } from "./use-circle-catalog";
import { EMPTY_PLANNING_DOCUMENT, deleteFavoriteGroup, moveFavoriteGroup, moveFavoritesToGroup, removeFromVisitPlan, toggleFavorite, updateFavoriteGroup } from "./planning-store";
import { exportPlanningCsv, exportPlanningJson } from "./planning-transfer";
import { usePlanning } from "./use-planning";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import styles from "./planning-tools.module.css";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function PlanningTools() {
  // Subscribe to the catalog so orphan detection re-runs once records arrive,
  // instead of reporting every favorite as unmatched while the snapshot loads.
  const { status: catalogStatus } = useCircleCatalog(ACTIVE_EVENT_ID);
  const { document, update, replace, storageError, unsupportedRaw } = usePlanning(ACTIVE_EVENT_ID, catalogStatus !== "loading");
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [groupTargets, setGroupTargets] = useState<Record<string, string>>( {} );
  const [batchSource, setBatchSource] = useState<string>("ALL");
  const [batchTarget, setBatchTarget] = useState<string>("");
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalFocus(open, dialogRef, () => setOpen(false));
  const memoCount = document.favorites.filter((item) => item.memo.trim()).length;
  const batchSourceId = batchSource === "ALL" ? "ALL" : batchSource || null;
  const batchCount = document.favorites.filter((favorite) => favorite.eventId === ACTIVE_EVENT_ID && (batchSourceId === "ALL" || favorite.groupId === batchSourceId)).length;
  const orphanFavorites = document.favorites.filter((favorite) => favorite.eventId === ACTIVE_EVENT_ID && !isKnownCircleId(favorite.circleId, favorite.eventId));
  const orphanPlans = document.visitPlans.filter((entry) => entry.eventId === ACTIVE_EVENT_ID && !isKnownCircleId(entry.circleId, entry.eventId));

  return <>
    <button className={styles.launcher} onClick={() => setOpen(true)}>資料管理</button>
    {open && createPortal(<div className={styles.backdrop} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="planning-tools-title" tabIndex={-1}>
      <header><div><small>LOCAL PLANNING DATA</small><h2 id="planning-tools-title">規劃資料管理</h2></div><button onClick={() => setOpen(false)} aria-label="關閉規劃資料管理"><UiIcon name="close" /></button></header>
      {storageError && <div className={styles.preview} role="alert"><b>原始規劃資料受到保護</b><p>{storageError}</p>{unsupportedRaw && <button onClick={() => download("場刊Map-原始規劃資料.json", unsupportedRaw, "application/json")}>先下載原始資料</button>}</div>}
      <div className={styles.summary}><span><b>{document.favorites.length}</b> 收藏</span><span><b>{memoCount}</b> 備註</span><span><b>{document.visitPlans.length}</b> 行程項目</span><span><b>{document.favoriteGroups.length}</b> 群組</span></div>
      <section className={styles.section}><div><h3>匯出備份</h3><p>只包含群組、收藏、備註、行程、購買項目與預算，不包含瀏覽歷程或帳號憑證。</p></div><div className={styles.actions}><button onClick={() => download("circle-plan.json", exportPlanningJson(document), "application/json")}>匯出 JSON</button><button onClick={() => download("circle-plan.csv", exportPlanningCsv(document), "text/csv;charset=utf-8")}>匯出 CSV v1</button></div></section>
      <section className={styles.section}><div><h3>收藏群組管理</h3><p>可改名、換色、排序；刪除前必須選擇把群組內收藏移到別處或未分組。</p></div>{document.favoriteGroups.length === 0 ? <small>尚未建立群組。</small> : <div className={styles.groupList}>{document.favoriteGroups.map((group, index) => <div key={group.id} className={styles.groupRow}>
        <input aria-label={`${group.name} 群組名稱`} defaultValue={group.name} onBlur={(event) => update((current) => updateFavoriteGroup(current, group.id, { name: event.target.value }))} />
        <select aria-label={`${group.name} 群組顏色`} value={group.color} onChange={(event) => update((current) => updateFavoriteGroup(current, group.id, { color: event.target.value }))}><option value="coral">珊瑚</option><option value="mint">薄荷</option><option value="blue">藍</option><option value="amber">琥珀</option><option value="lilac">紫</option></select>
        <button disabled={index === 0} onClick={() => update((current) => moveFavoriteGroup(current, group.id, -1))} aria-label={`${group.name} 群組往前移`}><UiIcon name="arrow-up" /></button><button disabled={index === document.favoriteGroups.length - 1} onClick={() => update((current) => moveFavoriteGroup(current, group.id, 1))} aria-label={`${group.name} 群組往後移`}><UiIcon name="arrow-down" /></button>
        <select aria-label={`刪除 ${group.name} 時的移動目標`} value={groupTargets[group.id] ?? ""} onChange={(event) => setGroupTargets({ ...groupTargets, [group.id]: event.target.value })}><option value="">移到未分組</option>{document.favoriteGroups.filter((item) => item.id !== group.id).map((item) => <option key={item.id} value={item.id}>移到 {item.name}</option>)}</select>
        <button onClick={() => { const count = document.favorites.filter((favorite) => favorite.groupId === group.id).length; if (window.confirm(`刪除「${group.name}」並移動其中 ${count} 筆收藏？`)) update((current) => deleteFavoriteGroup(current, group.id, groupTargets[group.id] || null)); }}>刪除</button>
      </div>)}<div className={styles.batchRow}><label>批次來源<select value={batchSource} onChange={(event) => setBatchSource(event.target.value)}><option value="ALL">全部收藏</option><option value="">未分組</option>{document.favoriteGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>移動到<select value={batchTarget} onChange={(event) => setBatchTarget(event.target.value)}><option value="">未分組</option>{document.favoriteGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><button disabled={batchCount === 0 || batchSourceId === (batchTarget || null)} onClick={() => { update((current) => moveFavoritesToGroup(current, ACTIVE_EVENT_ID, batchSourceId, batchTarget || null)); setNotice(`已移動 ${batchCount} 筆收藏。`); }}>移動 {batchCount} 筆</button></div></div>}</section>
      {(orphanFavorites.length > 0 || orphanPlans.length > 0) && <section className={styles.section}><div><h3>目前無法匹配的規劃資料</h3><p>社團可能已取消、移動或不在目前場刊；備註、行程與購物規劃會保留，您仍可匯出或逐筆移除。</p></div><div className={styles.orphanList}>{orphanFavorites.map((favorite) => <div key={`favorite-${favorite.circleId}`}><span><b>{favorite.circleId}</b><small>收藏{favorite.memo ? ` · 備註：${favorite.memo}` : ""}</small></span><button onClick={() => update((current) => toggleFavorite(current, favorite.eventId, favorite.circleId))}>移除收藏</button></div>)}{orphanPlans.map((entry) => <div key={`plan-${entry.day}-${entry.circleId}`}><span><b>{entry.circleId}</b><small>DAY {entry.day} · {entry.status === "next" ? "下一站" : entry.status === "visited" ? "已走訪" : "待前往"}{entry.purchaseMemo ? ` · ${entry.purchaseMemo}` : ""}{entry.budget !== null ? ` · NT$ ${entry.budget.toLocaleString("zh-TW")}` : ""}</small></span><button onClick={() => update((current) => removeFromVisitPlan(current, entry.eventId, entry.day, entry.circleId))}>移除行程</button></div>)}</div></section>}
      <section className={`${styles.section} ${styles.danger}`}><div><h3>清除所有規劃資料</h3><p>會移除 {document.favorites.length} 筆收藏、{memoCount} 筆備註、{document.visitPlans.length} 筆行程與 {document.favoriteGroups.length} 個群組。若目前版本不相容，也會覆寫受保護的原始資料。</p></div>{confirmClear ? <div className={styles.confirmRow}><span>確定要永久清除這台裝置上的資料？</span><button onClick={() => { replace(EMPTY_PLANNING_DOCUMENT); setConfirmClear(false); setNotice("已清除所有規劃資料。"); }}>確定清除</button><button onClick={() => setConfirmClear(false)}>取消</button></div> : <button onClick={() => setConfirmClear(true)}>清除資料…</button>}</section>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </section></div>, globalThis.document.body)}
  </>;
}
