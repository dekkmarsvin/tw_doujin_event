"use client";

/* eslint-disable @next/next/no-img-element -- FF47 media URLs are source-controlled remote assets, not build-time application images. */

import { useState } from "react";
import type { MouseEvent } from "react";
import type { CircleCatalogStatus, CircleMedia, CircleViewRecord, SourceContentType } from "./circle-records";
import type { CircleMatchReason } from "./circle-search";
import type { EventDayKey, FavoriteGroup, FavoriteRecord, VisitPlanEntry } from "./planning-store";
import { UiIcon } from "./ui-icons";
import styles from "./event-workspace-panels.module.css";

const RESULT_LIMIT = 80;

export type ActiveResultFilter = { id: string; label: string; onClear: () => void };

/** Only the states that change what a reader can do; healthy sources stay silent. */
const SOURCE_STATUS_NOTE = {
  linked: "",
  stale: "可能已過期",
  unavailable: "來源暫時無法開啟",
  unverified: "",
} as const;

/** Shared with the circle portal so an author picks kinds by the name readers see. */
export const LINK_KIND_LABEL = {
  social: "社群與作者",
  support: "贊助平台",
  website: "網站與其他連結",
  announcement: "本次預告",
  catalog: "品書",
  store: "預購／通販",
  sample: "試閱",
} as const;

function sourceDate(value: string) {
  const date = value.slice(0, 10).replaceAll("-", ".");
  return date || "時間不明";
}

/** Organizer rows were imported; circle rows were typed here, so they read as an update. */
function sourceDateLabel(source: { contentType: SourceContentType; fetchedAt: string }) {
  return `${source.contentType === "circle" ? "最後更新" : "匯入"} ${sourceDate(source.fetchedAt)}`;
}

export function SearchResults({ records, catalogStatus, catalogError, selectedId, favoriteIds, favoriteGroupLabels, plans, density, mediaCount, query, activeFilters, matchReasons, advancedSearchActive, onSelect, onToggleFavorite, onResetAdvancedSearch, onClearFilters, onClearQuery }: {
  records: CircleViewRecord[];
  catalogStatus: CircleCatalogStatus;
  catalogError: string;
  selectedId: string | null;
  favoriteIds: Set<string>;
  favoriteGroupLabels: Map<string, string>;
  plans: Map<string, VisitPlanEntry>;
  density: "compact" | "informative";
  mediaCount: 0 | 1 | 3;
  query: string;
  activeFilters: ActiveResultFilter[];
  /** Why each visible circle is in the result set, keyed by `recordId`. */
  matchReasons: Map<string, CircleMatchReason[]>;
  advancedSearchActive: boolean;
  onSelect: (record: CircleViewRecord) => void;
  onToggleFavorite: (record: CircleViewRecord) => void;
  onResetAdvancedSearch: () => void;
  onClearFilters: () => void;
  onClearQuery: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(RESULT_LIMIT);
  const loadingCatalog = catalogStatus === "loading";
  return <section className={styles.results} aria-label="搜尋結果" aria-live="polite">
    <header><div><b>搜尋結果</b><small>{loadingCatalog ? "正在讀取社團資料…" : `${records.length} 個社團`}</small></div><div className={styles.resultHeaderActions}>{records.length > visibleCount && <span>已顯示 {visibleCount} 筆</span>}{advancedSearchActive && <button type="button" onClick={onResetAdvancedSearch} aria-label="重設詳細搜尋">重設</button>}</div></header>
    {loadingCatalog ? <div className={styles.resultList} aria-hidden="true">
      {Array.from({ length: 8 }, (unused, index) => <article key={index} className={styles.resultSkeleton}><span /><span /></article>)}
    </div> : catalogStatus === "error" ? <div className={styles.empty}>
      <b>社團資料讀取失敗</b>
      <p>{catalogError || "請確認網路連線後重新整理頁面。"}</p>
    </div> : records.length === 0 ? <div className={styles.empty}><b>找不到符合條件的社團</b><p>{query.trim() ? <>保留搜尋「{query.trim()}」，可先移除下列篩選條件。</> : <>試著移除已套用的篩選條件。</>}</p>{activeFilters.length > 0 && <div className={styles.emptyFilters} aria-label="已套用篩選">{activeFilters.map((filter) => <button key={filter.id} onClick={filter.onClear} aria-label={`移除篩選：${filter.label}`}>{filter.label}<UiIcon name="close" /></button>)}</div>}<button onClick={activeFilters.length > 0 ? onClearFilters : onClearQuery}>{activeFilters.length > 0 ? "清除所有篩選（保留搜尋）" : "清除搜尋"}</button></div> : <div className={styles.resultList}>
      {records.slice(0, visibleCount).map((record) => {
        const plan = plans.get(record.circle.id);
        const thumbnail = record.circle.media[0];
        const circleSummary = [record.circle.circleCategory, record.circle.creatorTypes.join("、"), record.circle.work].filter(Boolean);
        const showsCircleAuthoredContent = record.sources.some((source) => source.contentType === "circle")
          && (circleSummary.length > 0 || (mediaCount > 0 && !!thumbnail));
        // Compact density is a scanning mode; the reasons belong to the mode
        // where the reader is asking why a row is here.
        const reasons = density === "informative" ? matchReasons.get(record.recordId) ?? [] : [];
        return <article key={record.recordId} className={`${selectedId === record.recordId ? styles.selectedResult : ""} ${density === "compact" ? styles.compactResult : ""}`}>
          <button className={`${styles.resultMain} ${mediaCount > 0 && thumbnail ? styles.resultWithMedia : ""}`} onClick={() => onSelect(record)}>
            {mediaCount > 0 && thumbnail && <span className={styles.resultMedia}><img src={thumbnail.url} alt="" loading="lazy" referrerPolicy="no-referrer" /></span>}
            <span className={`${styles.boothCode} ${styles[record.tone]}`}>{record.code}</span>
            <span className={styles.resultCopy}><b>{record.name}</b>{density === "informative" && <>{circleSummary.length > 0 && <small>{circleSummary.join(" · ")}</small>}{showsCircleAuthoredContent && <small className={styles.sourceHint}>由社團填寫</small>}{reasons.length > 0 && <span className={styles.matchReasons}>{reasons.map((reason) => <em key={reason.id}>{reason.label}</em>)}</span>}</>}</span>
            {favoriteGroupLabels.has(record.circle.id) && <span className={styles.state}>收藏：{favoriteGroupLabels.get(record.circle.id)}</span>}
            {plan && <span className={styles.state}>{plan.status === "visited" ? "已走訪" : plan.status === "next" ? "下一站" : "行程"}</span>}
          </button>
          <button className={`${styles.heart} ${favoriteIds.has(record.circle.id) ? styles.saved : ""}`} onClick={() => onToggleFavorite(record)} aria-label={favoriteIds.has(record.circle.id) ? `取消收藏 ${record.name}` : `收藏 ${record.name}`}><UiIcon name="heart" /></button>
        </article>;
      })}
      {visibleCount < records.length && <button className={styles.loadMore} onClick={() => setVisibleCount((count) => Math.min(records.length, count + RESULT_LIMIT))}>載入更多（剩餘 {records.length - visibleCount} 筆）</button>}
    </div>}
  </section>;
}

export function DayItinerary({ day, entries, recordsById, variant = "compact", onSelect, onMove, onMoveTo, onVisit, onRemove, onUpdatePurchase }: {
  day: EventDayKey;
  entries: VisitPlanEntry[];
  recordsById: Map<string, CircleViewRecord>;
  variant?: "compact" | "full";
  onSelect: (record: CircleViewRecord) => void;
  onMove: (circleId: string, direction: -1 | 1) => void;
  onMoveTo: (circleId: string, targetIndex: number) => void;
  onVisit: (entry: VisitPlanEntry) => void;
  onRemove: (circleId: string) => void;
  onUpdatePurchase: (circleId: string, purchaseMemo: string, budget: number | null) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const budgetTotal = entries.reduce((total, entry) => total + (entry.budget ?? 0), 0);
  const shoppingCount = entries.filter((entry) => entry.purchaseMemo.trim() || entry.budget !== null).length;
  const formatBudget = (value: number) => new Intl.NumberFormat("zh-TW").format(value);
  return <section className={`${styles.itinerary} ${variant === "full" ? styles.fullItinerary : styles.compactItinerary}`} aria-label={`DAY ${day} 當日行程列表`}>
    <header><div><h2>當日行程列表</h2></div><span>{entries.length} 站</span></header>
    {entries.length > 0 && <div className={styles.shoppingSummary}><b>今日購物規劃</b><span>{shoppingCount > 0 ? `${shoppingCount} 攤已填寫 · ` : "尚未填寫購買項目 · "}預算合計 NT$ {formatBudget(budgetTotal)}</span></div>}
    {entries.length === 0 ? <div className={styles.empty}><b>還沒有安排攤位</b><p>從搜尋結果或社團詳細資訊加入。</p></div> : <ol>
      {entries.map((entry, index) => {
        const record = recordsById.get(entry.circleId);
        if (!record) return null;
        const purchaseEditorVisible = variant === "full" || editingPurchaseId === entry.circleId;
        const purchaseSummary = [entry.purchaseMemo.trim(), entry.budget !== null ? `NT$ ${formatBudget(entry.budget)}` : ""].filter(Boolean).join(" · ");
        return <li key={entry.circleId} draggable={!purchaseEditorVisible} onDragStart={(event) => { setDraggingId(entry.circleId); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", entry.circleId); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const circleId = draggingId ?? event.dataTransfer.getData("text/plain"); if (circleId) onMoveTo(circleId, index); setDraggingId(null); }} onDragEnd={() => setDraggingId(null)} className={`${entry.status === "next" ? styles.next : entry.status === "visited" ? styles.visited : ""} ${draggingId === entry.circleId ? styles.dragging : ""}`}>
          <div className={styles.itineraryRow}><span className={styles.dragHandle} aria-hidden="true"><UiIcon name="drag" /></span><button className={styles.planMain} onClick={() => onSelect(record)}><span>{index + 1}</span><div><b>{record.code} · {record.name}</b><small>{entry.status === "next" ? "下一站" : entry.status === "visited" ? "已走訪" : "待前往"}</small></div></button>
            <div className={styles.planActions}>
              <button disabled={index === 0} onClick={() => onMove(entry.circleId, -1)} aria-label={`將 ${record.name} 往前移`}><UiIcon name="arrow-up" /></button>
              <button disabled={index === entries.length - 1} onClick={() => onMove(entry.circleId, 1)} aria-label={`將 ${record.name} 往後移`}><UiIcon name="arrow-down" /></button>
              <button className={styles.visitToggle} aria-pressed={entry.status === "visited"} aria-label={entry.status === "visited" ? `將 ${record.name} 標示為待前往` : `將 ${record.name} 標示為已走訪`} onClick={() => onVisit(entry)}><UiIcon name={entry.status === "visited" ? "check-square" : "square"} /></button>
              <button onClick={() => onRemove(entry.circleId)} aria-label={`從行程移除 ${record.name}`}><UiIcon name="close" /></button>
            </div>
          </div>
          {variant === "compact" && <button type="button" className={styles.purchaseToggle} aria-expanded={purchaseEditorVisible} onClick={() => setEditingPurchaseId((current) => current === entry.circleId ? null : entry.circleId)}><span>{purchaseSummary || "新增購買項目與預算"}</span><b>{purchaseEditorVisible ? "收合" : purchaseSummary ? "編輯" : "新增"}</b></button>}
          {purchaseEditorVisible && <div className={styles.purchaseEditor}>
            <label><span>購買項目</span><textarea value={entry.purchaseMemo} onChange={(event) => onUpdatePurchase(entry.circleId, event.target.value, entry.budget)} placeholder="例如：新刊 1 本、壓克力立牌" /></label>
            <label><span>預算（NT$）</span><input type="number" inputMode="numeric" min="0" step="1" value={entry.budget ?? ""} onChange={(event) => onUpdatePurchase(entry.circleId, entry.purchaseMemo, event.target.value === "" ? null : Number(event.target.value))} placeholder="0" /></label>
          </div>}
        </li>;
      })}
    </ol>}
  </section>;
}

function CircleMediaGallery({ media, activeIndex, compact, readOnly = false, onActiveIndex, onOpenFull }: {
  media: CircleMedia[];
  activeIndex: number;
  compact: boolean;
  readOnly?: boolean;
  onActiveIndex: (index: number) => void;
  onOpenFull?: () => void;
}) {
  const activeMedia = media[Math.min(activeIndex, media.length - 1)];
  if (!activeMedia) return null;
  const image = <img src={activeMedia.url} alt={activeMedia.alt} referrerPolicy="no-referrer" loading={compact ? "lazy" : undefined} />;
  const move = (delta: number) => onActiveIndex((activeIndex + delta + media.length) % media.length);
  return <div className={`${styles.mediaGallery} ${compact ? styles.compactGallery : styles.fullGallery}`} role="group" aria-label="社團圖片">
    {compact && onOpenFull
      ? <button className={styles.galleryOpen} disabled={readOnly} onClick={onOpenFull} aria-label={`開啟 ${activeMedia.alt} 的完整詳細資訊`}>{image}</button>
      : <div className={styles.galleryFrame}>{image}</div>}
    {!compact && <div className={styles.galleryFooter}>
      {media.length > 1 && <div className={styles.galleryControls} role="group" aria-label="圖片幻燈片控制">
        <button type="button" disabled={readOnly} onClick={() => move(-1)} aria-label="上一張圖片"><UiIcon name="chevron-left" /></button>
        <div><span aria-live="polite">{activeIndex + 1} / {media.length}</span><div className={styles.galleryRail}>{media.map((item, index) => <button type="button" disabled={readOnly} key={item.id} className={index === activeIndex ? styles.activeMedia : ""} onClick={() => onActiveIndex(index)} aria-label={`顯示第 ${index + 1} 張圖片`} aria-pressed={index === activeIndex}><img src={item.url} alt="" referrerPolicy="no-referrer" loading="lazy" /></button>)}</div></div>
        <button type="button" disabled={readOnly} onClick={() => move(1)} aria-label="下一張圖片"><UiIcon name="chevron-right" /></button>
      </div>}
      <a className={styles.mediaSource} href={activeMedia.sourceUrl} target="_blank" rel="noreferrer" aria-disabled={readOnly || undefined} tabIndex={readOnly ? -1 : undefined} onClick={readOnly ? preventLinkActivation : undefined}><span>{activeMedia.provider}</span><span>原始來源</span><UiIcon name="external" /></a>
    </div>}
  </div>;
}

function preventLinkActivation(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
}

export function CircleDetails({ record, sharedRecords, favorite, plan, groups, compact = false, readOnly = false, onClose, onOpenFull, onSelectShared, onToggleFavorite, onTogglePlan, onSetNext, onUpdateFavorite, onCreateGroup }: {
  record: CircleViewRecord | null;
  sharedRecords: CircleViewRecord[];
  favorite: FavoriteRecord | null;
  plan: VisitPlanEntry | null;
  groups: FavoriteGroup[];
  compact?: boolean;
  readOnly?: boolean;
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
  const [mediaSelection, setMediaSelection] = useState({ circleId: "", index: 0 });
  if (!record) return <section className={styles.detailEmpty} aria-label="攤位詳細資訊"><span><UiIcon name="map-pin" /></span><b>選擇一個攤位</b></section>;
  const activeMediaIndex = mediaSelection.circleId === record.circle.id ? mediaSelection.index : 0;
  const visibleLinks = compact ? record.circle.externalLinks.slice(0, 6) : record.circle.externalLinks;
  return <section className={`${styles.details} ${compact ? styles.compactDetails : styles.fullDetails} ${record.circle.media.length > 0 ? styles.detailsWithMedia : ""}`} aria-label="攤位詳細資訊">
    <CircleMediaGallery media={record.circle.media} activeIndex={activeMediaIndex} compact={compact} readOnly={readOnly} onActiveIndex={(index) => setMediaSelection({ circleId: record.circle.id, index })} onOpenFull={onOpenFull} />
    <div className={styles.detailBody}>
      <div className={styles.detailHeader}><div className={styles.placementMeta} aria-label={`攤位 ${record.code}，DAY ${record.day}，全館`}><strong className={styles[record.tone]}>{record.code}</strong><span>DAY {record.day}</span><span>全館</span></div><button className={styles.detailClose} disabled={readOnly} onClick={onClose} aria-label="關閉攤位詳細資訊"><UiIcon name="close" /></button></div>
      <div className={styles.title}><div><h2>{record.name}</h2>{(record.circle.circleCategory || record.circle.creatorTypes.length > 0 || record.circle.pen) && <p>{[record.circle.circleCategory, record.circle.creatorTypes.join("、"), record.circle.pen].filter(Boolean).join(" · ")}</p>}{record.circle.ageRatings.length > 0 && <small className={styles.rating}>分級：{record.circle.ageRatings.join("、")}</small>}</div><button className={`${styles.heart} ${favorite ? styles.saved : ""}`} disabled={readOnly} onClick={onToggleFavorite} aria-label={favorite ? "取消收藏" : "收藏社團"}><UiIcon name="heart" /></button></div>
      {favorite?.groupId && <p className={styles.sourceHint}>收藏群組：{groups.find((group) => group.id === favorite.groupId)?.name ?? "未分組"}</p>}
      {sharedRecords.length > 1 && <div className={styles.shared}><small>此攤位登記 {sharedRecords.length} 個社團</small>{sharedRecords.map((item) => <button key={item.recordId} disabled={readOnly} className={item.recordId === record.recordId ? styles.activeShared : ""} onClick={() => onSelectShared(item)}><b>{item.name}</b><span>{item.genre}</span></button>)}</div>}
      {!compact && <div className={styles.tags}>{[...new Set([...record.circle.workTypes, ...record.circle.referencedWorks, ...record.circle.specialTags, ...record.tags.map((tag) => tag.trim())])].filter(Boolean).map((tag) => <span key={tag}>#{tag}</span>)}</div>}
      {(record.circle.work || record.circle.saleInfo || record.note) && <div className={styles.work}><small>作品與販售資訊</small>{record.circle.work && <b>{record.circle.work}</b>}{(record.circle.saleInfo || record.note) && <p>{record.circle.saleInfo || record.note}</p>}</div>}
      {visibleLinks.length > 0 && <div className={styles.externalLinks} aria-label="社團外部連結"><b>更多資訊</b><div>{visibleLinks.map((link) => <a key={`${link.kind}-${link.provider}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" aria-disabled={readOnly || undefined} tabIndex={readOnly ? -1 : undefined} onClick={readOnly ? preventLinkActivation : undefined}><span>{link.provider}</span><small>{LINK_KIND_LABEL[link.kind]}</small><UiIcon name="external" /></a>)}</div>{compact && record.circle.externalLinks.length > visibleLinks.length && <small>完整詳細資訊另有 {record.circle.externalLinks.length - visibleLinks.length} 個連結</small>}</div>}
      <div className={styles.detailActions}><button className={styles.primary} disabled={readOnly} onClick={onTogglePlan}>{plan ? "從行程移除" : "加入今日行程"}</button><button disabled={readOnly || plan?.status === "next"} onClick={onSetNext}>{plan?.status === "next" ? "目前下一站" : "設為下一站"}</button></div>
      {compact && <><div className={styles.sourceSummary}><b>資料來源</b><span>{record.sources.map((source) => source.provider).join("、")}</span></div><button className={styles.fullDetailButton} disabled={readOnly} onClick={onOpenFull}>開啟完整詳細資訊</button></>}
      {!compact && favorite && <div className={styles.favoriteEditor}>
        <label>收藏分組<select disabled={readOnly} value={favorite.groupId ?? ""} onChange={(event) => onUpdateFavorite(event.target.value || null, favorite.memo)}><option value="">未分組</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>備註<textarea disabled={readOnly} value={favorite.memo} onChange={(event) => onUpdateFavorite(favorite.groupId, event.target.value)} placeholder="記下想買的刊物、預算或提醒" /></label>
        <div className={styles.groupCreator}><input disabled={readOnly} value={newGroup} onChange={(event) => setNewGroup(event.target.value)} placeholder="新增收藏分組" /><button disabled={readOnly || !newGroup.trim()} onClick={() => { onCreateGroup(newGroup); setNewGroup(""); }}>新增</button></div>
      </div>}
      {!compact && <div className={styles.sources} aria-label="資料來源">
        <b>資料來源</b>
        {record.sources.map((source) => <div key={`${source.provider}-${source.contentType}`}><span><strong>{source.provider}</strong>{source.label && <small>{source.label}</small>}{SOURCE_STATUS_NOTE[source.status] && <small>{SOURCE_STATUS_NOTE[source.status]}</small>}<small>{sourceDateLabel(source)}</small></span>{source.url && <a href={source.url} target="_blank" rel="noreferrer" aria-disabled={readOnly || undefined} tabIndex={readOnly ? -1 : undefined} onClick={readOnly ? preventLinkActivation : undefined}>原始來源 <UiIcon name="external" /></a>}</div>)}
      </div>}
    </div>
  </section>;
}
