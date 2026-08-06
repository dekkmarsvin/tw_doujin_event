"use client";

import { useState } from "react";
import type { CircleViewRecord } from "./circle-records";
import type { EventDayKey, FavoriteGroup, FavoriteRecord, VisitPlanEntry } from "./planning-store";
import { UiIcon } from "./ui-icons";
import styles from "./event-workspace-panels.module.css";

const RESULT_LIMIT = 80;

export type ActiveResultFilter = { id: string; label: string; onClear: () => void };

const SOURCE_STATUS_LABEL = {
  linked: "可核對",
  stale: "可能已過期",
  unavailable: "暫時無法核對",
  unverified: "尚未驗證",
} as const;

function sourceDate(value: string) {
  const date = value.slice(0, 10).replaceAll("-", ".");
  return date || "時間不明";
}

export function SearchResults({ records, selectedId, favoriteIds, favoriteGroupLabels, plans, density, query, activeFilters, onSelect, onToggleFavorite, onClearFilters, onClearQuery }: {
  records: CircleViewRecord[];
  selectedId: string | null;
  favoriteIds: Set<string>;
  favoriteGroupLabels: Map<string, string>;
  plans: Map<string, VisitPlanEntry>;
  density: "compact" | "informative";
  query: string;
  activeFilters: ActiveResultFilter[];
  onSelect: (record: CircleViewRecord) => void;
  onToggleFavorite: (record: CircleViewRecord) => void;
  onClearFilters: () => void;
  onClearQuery: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(RESULT_LIMIT);
  return <section className={styles.results} aria-label="搜尋結果" aria-live="polite">
    <header><div><b>搜尋結果</b><small>{records.length} 個社團</small></div>{records.length > visibleCount && <span>已顯示 {visibleCount} 筆</span>}</header>
    {records.length === 0 ? <div className={styles.empty}><b>找不到符合條件的社團</b><p>{query.trim() ? <>保留搜尋「{query.trim()}」，可先移除下列篩選條件。</> : <>試著移除已套用的篩選條件。</>}</p>{activeFilters.length > 0 && <div className={styles.emptyFilters} aria-label="已套用篩選">{activeFilters.map((filter) => <button key={filter.id} onClick={filter.onClear} aria-label={`移除篩選：${filter.label}`}>{filter.label}<UiIcon name="close" /></button>)}</div>}<button onClick={activeFilters.length > 0 ? onClearFilters : onClearQuery}>{activeFilters.length > 0 ? "清除所有篩選（保留搜尋）" : "清除搜尋"}</button></div> : <div className={styles.resultList}>
      {records.slice(0, visibleCount).map((record) => {
        const plan = plans.get(record.recordId);
        return <article key={record.recordId} className={`${selectedId === record.recordId ? styles.selectedResult : ""} ${density === "compact" ? styles.compactResult : ""}`}>
          <button className={styles.resultMain} onClick={() => onSelect(record)}>
            <span className={`${styles.boothCode} ${styles[record.tone]}`}>{record.code}</span>
            <span className={styles.resultCopy}><b>{record.name}</b>{density === "informative" && <><small>{record.genre} · {record.work}</small><small className={styles.sourceHint}>來源：開拓動漫＋社群整理</small></>}</span>
            {favoriteGroupLabels.has(record.recordId) && <span className={styles.state}>收藏：{favoriteGroupLabels.get(record.recordId)}</span>}
            {plan && <span className={styles.state}>{plan.status === "visited" ? "已走訪" : plan.status === "next" ? "下一站" : "行程"}</span>}
          </button>
          <button className={`${styles.heart} ${favoriteIds.has(record.recordId) ? styles.saved : ""}`} onClick={() => onToggleFavorite(record)} aria-label={favoriteIds.has(record.recordId) ? `取消收藏 ${record.name}` : `收藏 ${record.name}`}><UiIcon name="heart" /></button>
        </article>;
      })}
      {visibleCount < records.length && <button className={styles.loadMore} onClick={() => setVisibleCount((count) => Math.min(records.length, count + RESULT_LIMIT))}>載入更多（剩餘 {records.length - visibleCount} 筆）</button>}
    </div>}
  </section>;
}

export function DayItinerary({ day, entries, recordsById, onSelect, onMove, onMoveTo, onVisit, onRemove }: {
  day: EventDayKey;
  entries: VisitPlanEntry[];
  recordsById: Map<string, CircleViewRecord>;
  onSelect: (record: CircleViewRecord) => void;
  onMove: (circleId: string, direction: -1 | 1) => void;
  onMoveTo: (circleId: string, targetIndex: number) => void;
  onVisit: (entry: VisitPlanEntry) => void;
  onRemove: (circleId: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  return <section className={styles.itinerary} aria-label={`DAY ${day} 每日行程`}>
    <header><div><small>DAY {day} ROUTE</small><h2>我的每日行程</h2></div><span>{entries.length} 站</span></header>
    {entries.length === 0 ? <div className={styles.empty}><b>還沒有安排攤位</b><p>從搜尋結果或社團詳情加入；資料只會保存在這台裝置。</p></div> : <ol>
      {entries.map((entry, index) => {
        const record = recordsById.get(entry.circleId);
        if (!record) return null;
        return <li key={entry.circleId} draggable onDragStart={(event) => { setDraggingId(entry.circleId); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", entry.circleId); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const circleId = draggingId ?? event.dataTransfer.getData("text/plain"); if (circleId) onMoveTo(circleId, index); setDraggingId(null); }} onDragEnd={() => setDraggingId(null)} className={`${entry.status === "next" ? styles.next : entry.status === "visited" ? styles.visited : ""} ${draggingId === entry.circleId ? styles.dragging : ""}`}>
          <span className={styles.dragHandle} aria-hidden="true"><UiIcon name="drag" /></span><button className={styles.planMain} onClick={() => onSelect(record)}><span>{index + 1}</span><div><b>{record.code} · {record.name}</b><small>{entry.status === "next" ? "下一站" : entry.status === "visited" ? "已走訪" : "待前往"}</small></div></button>
          <div className={styles.planActions}>
            <button disabled={index === 0} onClick={() => onMove(entry.circleId, -1)} aria-label={`將 ${record.name} 往前移`}><UiIcon name="arrow-up" /></button>
            <button disabled={index === entries.length - 1} onClick={() => onMove(entry.circleId, 1)} aria-label={`將 ${record.name} 往後移`}><UiIcon name="arrow-down" /></button>
            <button onClick={() => onVisit(entry)}>{entry.status === "visited" ? "復原" : "走訪"}</button>
            <button onClick={() => onRemove(entry.circleId)} aria-label={`從行程移除 ${record.name}`}><UiIcon name="close" /></button>
          </div>
        </li>;
      })}
    </ol>}
  </section>;
}

export function CircleDetails({ record, sharedRecords, favorite, plan, groups, compact = false, onClose, onOpenFull, onSelectShared, onToggleFavorite, onTogglePlan, onSetNext, onUpdateFavorite, onCreateGroup }: {
  record: CircleViewRecord | null;
  sharedRecords: CircleViewRecord[];
  favorite: FavoriteRecord | null;
  plan: VisitPlanEntry | null;
  groups: FavoriteGroup[];
  compact?: boolean;
  onClose: () => void;
  onOpenFull?: () => void;
  onSelectShared: (record: CircleViewRecord) => void;
  onToggleFavorite: () => void;
  onTogglePlan: () => void;
  onSetNext: () => void;
  onUpdateFavorite: (groupId: string | null, memo: string) => void;
  onCreateGroup: (name: string) => void;
}) {
  const [newGroup, setNewGroup] = useState("");
  if (!record) return <section className={styles.detailEmpty} aria-label="攤位詳情"><span><UiIcon name="map-pin" /></span><b>選擇一個攤位</b><p>作品資訊、收藏備註與行程動作會集中顯示在這裡。</p></section>;
  return <section className={styles.details} aria-label="攤位詳情">
    <div className={`${styles.hero} ${styles[record.tone]}`}><div><span>{record.code}</span><small>{record.hall} 區 · DAY {record.day}</small></div><button onClick={onClose} aria-label="關閉攤位詳情"><UiIcon name="close" /></button><b>{record.work}</b></div>
    <div className={styles.detailBody}>
      <div className={styles.title}><div><h2>{record.name}</h2><p>{record.genre}{record.pen ? ` · ${record.pen}` : ""}</p></div><button className={`${styles.heart} ${favorite ? styles.saved : ""}`} onClick={onToggleFavorite} aria-label={favorite ? "取消收藏" : "收藏社團"}><UiIcon name="heart" /></button></div>
      {favorite?.groupId && <p className={styles.sourceHint}>收藏群組：{groups.find((group) => group.id === favorite.groupId)?.name ?? "未分組"}</p>}
      {sharedRecords.length > 1 && <div className={styles.shared}><small>此攤位登錄 {sharedRecords.length} 個社團</small>{sharedRecords.map((item) => <button key={item.recordId} className={item.recordId === record.recordId ? styles.activeShared : ""} onClick={() => onSelectShared(item)}><b>{item.name}</b><span>{item.genre}</span></button>)}</div>}
      {!compact && <div className={styles.tags}>{record.tags.map((tag) => <span key={tag}>#{tag.trim()}</span>)}</div>}
      <div className={styles.work}><small>作品與攤位資訊</small><b>{record.work}</b><p>{record.note}</p></div>
      <div className={styles.detailActions}><button className={styles.primary} onClick={onTogglePlan}>{plan ? "從行程移除" : "加入今日行程"}</button><button disabled={plan?.status === "next"} onClick={onSetNext}>{plan?.status === "next" ? "目前下一站" : "設為下一站"}</button></div>
      {compact && <><div className={styles.sourceSummary}><b>資料來源</b><span>{record.sources.map((source) => source.provider).join("、")}</span></div><button className={styles.fullDetailButton} onClick={onOpenFull}>開啟完整詳情</button></>}
      {!compact && favorite && <div className={styles.favoriteEditor}>
        <label>收藏分組<select value={favorite.groupId ?? ""} onChange={(event) => onUpdateFavorite(event.target.value || null, favorite.memo)}><option value="">未分組</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>備註<textarea value={favorite.memo} onChange={(event) => onUpdateFavorite(favorite.groupId, event.target.value)} placeholder="記下想買的刊物、預算或提醒" /></label>
        <div className={styles.groupCreator}><input value={newGroup} onChange={(event) => setNewGroup(event.target.value)} placeholder="新增收藏分組" /><button disabled={!newGroup.trim()} onClick={() => { onCreateGroup(newGroup); setNewGroup(""); }}>新增</button></div>
      </div>}
      {!compact && <div className={styles.sources} aria-label="資料來源">
        <b>資料來源</b>
        {record.sources.map((source) => <div key={`${source.provider}-${source.contentType}`}><span><strong>{source.provider}</strong><small>{source.label} · {source.contentType === "official" ? "主辦來源" : "非主辦官方"} · {SOURCE_STATUS_LABEL[source.status]}</small><small>匯入 {sourceDate(source.fetchedAt)}</small></span><a href={source.url} target="_blank" rel="noreferrer">查看原始來源 <UiIcon name="external" /></a></div>)}
        <p>社團與作品欄位由公開整理資料彙整；品項、庫存與臨時異動以社團及主辦現場公告為準。</p>
      </div>}
    </div>
  </section>;
}
