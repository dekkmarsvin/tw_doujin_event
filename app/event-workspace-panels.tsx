"use client";

import { useState } from "react";
import type { MouseEvent } from "react";
import { mediaAltLabel, placementStatusLabel, representativeMedia, sourceProviderLabel, sourceTitleLabel } from "./circle-records";
import type { CircleCatalogStatus, CircleMedia, CircleViewRecord } from "./circle-records";
import { linkKindLabel, sourceDateLabel } from "./circle-presentation";
import { circleOptionLabel } from "./circle-overrides";
import type { CircleMatchReason } from "./circle-search";
import { formatCount, formatTwd } from "./i18n/format";
import { localizedHref, type Locale } from "./i18n/locale";
import { useLocale, useMessages } from "./i18n/locale-context";
import { defineMessages, translate, type MessageParams } from "./i18n/messages";
import type { EventDayKey, FavoriteGroup, FavoriteRecord, VisitPlanEntry } from "./planning-store";
import { UiIcon } from "./ui-icons";
import { circlePath } from "./seo";
import styles from "./event-workspace-panels.module.css";

const RESULT_LIMIT = 80;

export type ActiveResultFilter = { id: string; label: string; onClear: () => void };

const count = (value: MessageParams[string], locale: Locale) => formatCount(Number(value), locale);
const enCount = (value: MessageParams[string], one: string, many: string) => Number(value) === 1 ? `1 ${one}` : `${count(value, "en")} ${many}`;

/**
 * The words of the search results, the day's plan and the circle details. The
 * circle details are shared by the map, the circle's own page and the circle
 * editor's preview, so all three read the language from context, not a prop.
 */
const MESSAGES = defineMessages({
  "zh-Hant": {
    results: "搜尋結果",
    loadingCatalog: "正在讀取社團資料…",
    resultCounts: "{circles} 個社團 · {results} 筆結果",
    shown: "已顯示 {count} 筆",
    resetAdvanced: "重設詳細搜尋",
    reset: "重設",
    catalogFailed: "社團資料讀取失敗",
    catalogFailedHint: "請確認網路連線後重新整理頁面。",
    noResults: "找不到符合條件的社團",
    keepQuery: "保留搜尋「{query}」，可先移除下列篩選條件。",
    removeFilters: "試著移除已套用的篩選條件。",
    appliedFilters: "已套用篩選",
    removeFilter: "移除篩選：{label}",
    clearFilters: "清除所有篩選（保留搜尋）",
    clearQuery: "清除搜尋",
    listSeparator: "、",
    circleAuthored: "由社團填寫",
    favoriteIn: "收藏：{group}",
    visited: "已走訪",
    next: "下一站",
    planned: "待前往",
    inPlan: "行程",
    unfavoriteCircle: "取消收藏 {name}",
    favoriteCircle: "收藏 {name}",
    loadMore: "載入更多（剩餘 {count} 筆）",
    dayPlanLabel: "DAY {day} 當日行程列表",
    dayPlan: "當日行程列表",
    sharePlan: "分享行程",
    stops: "{count} 站",
    shopping: "今日購物規劃",
    shoppingFilled: "{count} 攤已填寫 · ",
    shoppingEmpty: "尚未填寫購買項目 · ",
    budgetTotal: "預算合計 {amount}",
    noPlan: "還沒有安排攤位",
    noPlanHint: "從搜尋結果或社團詳細資訊加入。",
    moveUp: "將 {name} 往前移",
    moveDown: "將 {name} 往後移",
    markPlanned: "將 {name} 標示為待前往",
    markVisited: "將 {name} 標示為已走訪",
    removeFromPlan: "從行程移除 {name}",
    addPurchase: "新增購買項目與預算",
    collapse: "收合",
    edit: "編輯",
    add: "新增",
    purchaseItems: "購買項目",
    budget: "預算（NT$）",
    purchasePlaceholder: "例如：新刊 1 本、壓克力立牌",
    circleImages: "社團圖片",
    openFullFor: "開啟 {alt} 的完整詳細資訊",
    openOriginal: "開啟原圖：{alt}",
    slideshow: "圖片幻燈片控制",
    previousImage: "上一張圖片",
    nextImage: "下一張圖片",
    showImage: "顯示第 {index} 張圖片",
    originalSource: "原始來源",
    boothDetails: "攤位詳細資訊",
    chooseBooth: "選擇一個攤位",
    placement: "攤位 {code}，DAY {day}，全館",
    allAreas: "全館",
    closeDetails: "關閉攤位詳細資訊",
    rating: "分級：{ratings}",
    unfavorite: "取消收藏",
    favorite: "收藏社團",
    removePlan: "從行程移除",
    addPlan: "加入今日行程",
    currentNext: "目前下一站",
    setNext: "設為下一站",
    cancelledNotice: "主辦已從這一場的攤位清單移除這個社團，這個攤位不再是目的地。",
    movedTo: "這個社團已改到 DAY {day} {code}。",
    movedUnknown: "主辦標示這個攤位已移動，但沒有公布新位置。",
    seeNewBooth: "看新攤位 {code}",
    favoriteGroupOf: "收藏群組：{name}",
    ungrouped: "未分組",
    sharedBooth: "此攤位登記 {count} 個社團",
    workAndSales: "作品與販售資訊",
    externalLinks: "社團外部連結",
    moreInfo: "更多資訊",
    moreLinks: "完整詳細資訊另有 {count} 個連結",
    sources: "資料來源",
    sourceStale: "可能已過期",
    sourceUnavailable: "來源暫時無法開啟",
    openFull: "開啟完整詳細資訊",
    favoriteGroup: "收藏分組",
    memo: "備註",
    memoPlaceholder: "記下想買的刊物、預算或提醒",
    newGroup: "新增收藏分組",
    claimQuestion: "這是你的社團嗎？",
    claim: "認領／管理資料",
    circleContent: "社團內容",
  },
  en: {
    results: "Search results",
    loadingCatalog: "Loading circles…",
    resultCounts: ({ circles, results }) => `${enCount(circles, "circle", "circles")} · ${enCount(results, "result", "results")}`,
    shown: ({ count: shown }) => `Showing ${count(shown, "en")}`,
    resetAdvanced: "Reset advanced search",
    reset: "Reset",
    catalogFailed: "Couldn’t load circles",
    catalogFailedHint: "Check your connection and reload the page.",
    noResults: "No circles match",
    keepQuery: "Your search “{query}” is kept. Try removing the filters below.",
    removeFilters: "Try removing the filters you applied.",
    appliedFilters: "Applied filters",
    removeFilter: "Remove filter: {label}",
    clearFilters: "Clear all filters (keep search)",
    clearQuery: "Clear search",
    listSeparator: ", ",
    circleAuthored: "Added by the circle",
    favoriteIn: "Favorite: {group}",
    visited: "Visited",
    next: "Next stop",
    planned: "To visit",
    inPlan: "In plan",
    unfavoriteCircle: "Remove {name} from favorites",
    favoriteCircle: "Add {name} to favorites",
    loadMore: ({ count: left }) => `Load more (${count(left, "en")} left)`,
    dayPlanLabel: "DAY {day} plan",
    dayPlan: "Plan for this day",
    sharePlan: "Share plan",
    stops: ({ count: stops }) => enCount(stops, "stop", "stops"),
    shopping: "Shopping plan",
    shoppingFilled: ({ count: booths }) => `${enCount(booths, "booth", "booths")} filled in · `,
    shoppingEmpty: "No items added yet · ",
    budgetTotal: "Budget total {amount}",
    noPlan: "No booths planned yet",
    noPlanHint: "Add them from search results or circle details.",
    moveUp: "Move {name} up",
    moveDown: "Move {name} down",
    markPlanned: "Mark {name} as to visit",
    markVisited: "Mark {name} as visited",
    removeFromPlan: "Remove {name} from plan",
    addPurchase: "Add items and budget",
    collapse: "Collapse",
    edit: "Edit",
    add: "Add",
    purchaseItems: "Items to buy",
    budget: "Budget (NT$)",
    purchasePlaceholder: "e.g. 1 new book, acrylic stand",
    circleImages: "Circle images",
    openFullFor: "Open full details for {alt}",
    openOriginal: "Open original image: {alt}",
    slideshow: "Image slideshow controls",
    previousImage: "Previous image",
    nextImage: "Next image",
    showImage: "Show image {index}",
    originalSource: "Original source",
    boothDetails: "Booth details",
    chooseBooth: "Choose a booth",
    placement: "Booth {code}, DAY {day}, all areas",
    allAreas: "All areas",
    closeDetails: "Close booth details",
    rating: "Rating: {ratings}",
    unfavorite: "Remove from favorites",
    favorite: "Add to favorites",
    removePlan: "Remove from plan",
    addPlan: "Add to today’s plan",
    currentNext: "Current next stop",
    setNext: "Set as next stop",
    cancelledNotice: "The organizer removed this circle from this event’s booth list. This booth is no longer a destination.",
    movedTo: "This circle moved to DAY {day} {code}.",
    movedUnknown: "The organizer marked this booth as moved but hasn’t published the new location.",
    seeNewBooth: "See new booth {code}",
    favoriteGroupOf: "Favorite group: {name}",
    ungrouped: "Ungrouped",
    sharedBooth: ({ count: circles }) => `${enCount(circles, "circle", "circles")} at this booth`,
    workAndSales: "Works and sales info",
    externalLinks: "Circle links",
    moreInfo: "More info",
    moreLinks: ({ count: links }) => `${enCount(links, "more link", "more links")} in full details`,
    sources: "Sources",
    sourceStale: "May be out of date",
    sourceUnavailable: "Source temporarily unavailable",
    openFull: "Open full details",
    favoriteGroup: "Favorite group",
    memo: "Note",
    memoPlaceholder: "Books to buy, budget or reminders",
    newGroup: "New favorite group",
    claimQuestion: "Is this your circle?",
    claim: "Claim this circle",
    circleContent: "Circle content",
  },
  ja: {
    results: "検索結果",
    loadingCatalog: "サークル情報を読み込み中…",
    resultCounts: ({ circles, results }) => `${count(circles, "ja")}サークル · ${count(results, "ja")}件`,
    shown: ({ count: shown }) => `${count(shown, "ja")}件を表示中`,
    resetAdvanced: "詳細検索をリセット",
    reset: "リセット",
    catalogFailed: "サークル情報を読み込めませんでした",
    catalogFailedHint: "接続を確認して、ページを再読み込みしてください。",
    noResults: "条件に合うサークルが見つかりません",
    keepQuery: "検索「{query}」はそのままです。下の絞り込み条件を外してみてください。",
    removeFilters: "適用中の絞り込み条件を外してみてください。",
    appliedFilters: "適用中の絞り込み",
    removeFilter: "絞り込みを解除：{label}",
    clearFilters: "絞り込みをすべて解除（検索は保持）",
    clearQuery: "検索をクリア",
    listSeparator: "、",
    circleAuthored: "サークル記入",
    favoriteIn: "お気に入り：{group}",
    visited: "訪問済み",
    next: "次の行き先",
    planned: "未訪問",
    inPlan: "巡回プラン",
    unfavoriteCircle: "{name}をお気に入りから外す",
    favoriteCircle: "{name}をお気に入りに追加",
    loadMore: ({ count: left }) => `さらに読み込む（残り${count(left, "ja")}件）`,
    dayPlanLabel: "DAY {day} の巡回プラン",
    dayPlan: "この日の巡回プラン",
    sharePlan: "巡回プランを共有",
    stops: ({ count: stops }) => `${count(stops, "ja")}か所`,
    shopping: "購入予定",
    shoppingFilled: ({ count: booths }) => `${count(booths, "ja")}スペース記入済み · `,
    shoppingEmpty: "購入予定はまだありません · ",
    budgetTotal: "予算合計 {amount}",
    noPlan: "まだスペースが登録されていません",
    noPlanHint: "検索結果やサークル詳細から追加できます。",
    moveUp: "{name}を前へ移動",
    moveDown: "{name}を後ろへ移動",
    markPlanned: "{name}を未訪問にする",
    markVisited: "{name}を訪問済みにする",
    removeFromPlan: "{name}を巡回プランから外す",
    addPurchase: "購入予定と予算を追加",
    collapse: "閉じる",
    edit: "編集",
    add: "追加",
    purchaseItems: "購入予定",
    budget: "予算（NT$）",
    purchasePlaceholder: "例：新刊1冊、アクリルスタンド",
    circleImages: "サークル画像",
    openFullFor: "{alt}の詳細を開く",
    openOriginal: "元画像を開く：{alt}",
    slideshow: "画像スライドの操作",
    previousImage: "前の画像",
    nextImage: "次の画像",
    showImage: "{index}枚目の画像を表示",
    originalSource: "出典",
    boothDetails: "スペース詳細",
    chooseBooth: "スペースを選択",
    placement: "スペース {code}、DAY {day}、全館",
    allAreas: "全館",
    closeDetails: "スペース詳細を閉じる",
    rating: "年齢区分：{ratings}",
    unfavorite: "お気に入りから外す",
    favorite: "お気に入りに追加",
    removePlan: "巡回プランから外す",
    addPlan: "今日の巡回プランに追加",
    currentNext: "現在の次の行き先",
    setNext: "次の行き先にする",
    cancelledNotice: "主催者がこのイベントのスペース一覧からこのサークルを削除しました。このスペースは目的地ではなくなりました。",
    movedTo: "このサークルは DAY {day} {code} に移動しました。",
    movedUnknown: "主催者はこのスペースを移動済みとしていますが、新しい場所は公開されていません。",
    seeNewBooth: "新しいスペース {code} を見る",
    favoriteGroupOf: "お気に入りグループ：{name}",
    ungrouped: "未分類",
    sharedBooth: ({ count: circles }) => `このスペースには${count(circles, "ja")}サークルが登録されています`,
    workAndSales: "作品・頒布情報",
    externalLinks: "サークルのリンク",
    moreInfo: "関連リンク",
    moreLinks: ({ count: links }) => `詳細ページに他${count(links, "ja")}件のリンクがあります`,
    sources: "情報源",
    sourceStale: "古い可能性があります",
    sourceUnavailable: "情報源を一時的に開けません",
    openFull: "詳細をすべて表示",
    favoriteGroup: "お気に入りグループ",
    memo: "メモ",
    memoPlaceholder: "買いたい本、予算、メモなど",
    newGroup: "新しいお気に入りグループ",
    claimQuestion: "あなたのサークルですか？",
    claim: "サークル情報の管理申請",
    circleContent: "サークル内容",
  },
});

/** Only the states that change what a reader can do; healthy sources stay silent. */
const SOURCE_STATUS_NOTE = {
  linked: null,
  stale: "sourceStale",
  unavailable: "sourceUnavailable",
  unverified: null,
} as const;

/** The site's fixed creator, work-type and age-rating options in the interface
 * language; anything else a circle wrote stays as written. */
const optionList = (values: readonly string[], locale: Locale, separator: string) => values.map((value) => circleOptionLabel(value, locale)).join(separator);


export function SearchResults({ records, circleCount, catalogStatus, catalogError, selectedId, favoriteIds, favoriteGroupLabels, plans, density, mediaCount, query, activeFilters, matchReasons, advancedSearchActive, onSelect, onToggleFavorite, onResetAdvancedSearch, onClearFilters, onClearQuery }: {
  records: CircleViewRecord[];
  circleCount: number;
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
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);
  const loadingCatalog = catalogStatus === "loading";
  return <section className={styles.results} aria-label={t("results")} aria-live="polite">
    <header><div><b>{t("results")}</b><small>{loadingCatalog ? t("loadingCatalog") : t("resultCounts", { circles: circleCount, results: records.length })}</small></div><div className={styles.resultHeaderActions}>{records.length > visibleCount && <span>{t("shown", { count: visibleCount })}</span>}{advancedSearchActive && <button type="button" onClick={onResetAdvancedSearch} aria-label={t("resetAdvanced")}>{t("reset")}</button>}</div></header>
    {loadingCatalog ? <div className={styles.resultList} aria-hidden="true">
      {Array.from({ length: 8 }, (unused, index) => <article key={index} className={styles.resultSkeleton}><span /><span /></article>)}
    </div> : catalogStatus === "error" ? <div className={styles.empty}>
      <b>{t("catalogFailed")}</b>
      <p>{locale === "zh-Hant" && catalogError ? catalogError : t("catalogFailedHint")}</p>
    </div> : records.length === 0 ? <div className={styles.empty}><b>{t("noResults")}</b><p>{query.trim() ? t("keepQuery", { query: query.trim() }) : t("removeFilters")}</p>{activeFilters.length > 0 && <div className={styles.emptyFilters} aria-label={t("appliedFilters")}>{activeFilters.map((filter) => <button key={filter.id} onClick={filter.onClear} aria-label={t("removeFilter", { label: filter.label })}>{filter.label}<UiIcon name="close" /></button>)}</div>}<button onClick={activeFilters.length > 0 ? onClearFilters : onClearQuery}>{activeFilters.length > 0 ? t("clearFilters") : t("clearQuery")}</button></div> : <div className={styles.resultList}>
      {records.slice(0, visibleCount).map((record) => {
        const plan = plans.get(record.circle.id);
        const thumbnail = representativeMedia(record.circle.media);
        const circleSummary = [record.circle.circleCategory, optionList(record.circle.creatorTypes, locale, t("listSeparator")), record.circle.work].filter(Boolean);
        const showsCircleAuthoredContent = record.sources.some((source) => source.contentType === "circle")
          && (circleSummary.length > 0 || (mediaCount > 0 && !!thumbnail));
        // Compact density is a scanning mode; the reasons belong to the mode
        // where the reader is asking why a row is here.
        const reasons = density === "informative" ? matchReasons.get(record.recordId) ?? [] : [];
        return <article key={record.recordId} className={`${selectedId === record.recordId ? styles.selectedResult : ""} ${density === "compact" ? styles.compactResult : ""}`}>
          <a href={localizedHref(circlePath(record.placement.eventId, record.circle.id), locale)} className={`${styles.resultMain} ${mediaCount > 0 && thumbnail ? styles.resultWithMedia : ""}`} onClick={(click) => {
            if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
            click.preventDefault();
            onSelect(record);
          }}>
            {mediaCount > 0 && thumbnail && <span className={styles.resultMedia}><img src={thumbnail.url} alt="" loading="lazy" referrerPolicy="no-referrer" /></span>}
            <span className={`${styles.boothCode} ${styles[record.tone]}`}>{record.code}</span>
            <span className={styles.resultCopy}><b>{record.name}</b>{density === "informative" && <>{circleSummary.length > 0 && <small>{circleSummary.join(" · ")}</small>}{showsCircleAuthoredContent && <small className={styles.sourceHint}>{t("circleAuthored")}</small>}{reasons.length > 0 && <span className={styles.matchReasons}>{reasons.map((reason) => <em key={reason.id}>{reason.label}</em>)}</span>}</>}</span>
            {favoriteGroupLabels.has(record.circle.id) && <span className={styles.state}>{t("favoriteIn", { group: favoriteGroupLabels.get(record.circle.id)! })}</span>}
            {record.placement.status !== "active" && <span className={styles.retiredState}>{placementStatusLabel(record.placement.status, locale)}</span>}
            {plan && <span className={styles.state}>{plan.status === "visited" ? t("visited") : plan.status === "next" ? t("next") : t("inPlan")}</span>}
          </a>
          <button className={`${styles.heart} ${favoriteIds.has(record.circle.id) ? styles.saved : ""}`} onClick={() => onToggleFavorite(record)} aria-label={favoriteIds.has(record.circle.id) ? t("unfavoriteCircle", { name: record.name }) : t("favoriteCircle", { name: record.name })}><UiIcon name="heart" /></button>
        </article>;
      })}
      {visibleCount < records.length && <button className={styles.loadMore} onClick={() => setVisibleCount((count) => Math.min(records.length, count + RESULT_LIMIT))}>{t("loadMore", { count: records.length - visibleCount })}</button>}
    </div>}
  </section>;
}

export function DayItinerary({ day, entries, recordsById, variant = "compact", onSelect, onMove, onMoveTo, onVisit, onRemove, onUpdatePurchase, onShare }: {
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
  /** Opens 分享行程 (#415): short link and QR code for this event's itinerary. */
  onShare?: () => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const budgetTotal = entries.reduce((total, entry) => total + (entry.budget ?? 0), 0);
  const shoppingCount = entries.filter((entry) => entry.purchaseMemo.trim() || entry.budget !== null).length;
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);
  return <section className={`${styles.itinerary} ${variant === "full" ? styles.fullItinerary : styles.compactItinerary}`} aria-label={t("dayPlanLabel", { day })}>
    <header><div><h2>{t("dayPlan")}</h2></div>{onShare && <button type="button" className={styles.headerAction} onClick={onShare}>{t("sharePlan")}</button>}<span>{t("stops", { count: entries.length })}</span></header>
    {entries.length > 0 && <div className={styles.shoppingSummary}><b>{t("shopping")}</b><span>{shoppingCount > 0 ? t("shoppingFilled", { count: shoppingCount }) : t("shoppingEmpty")}{t("budgetTotal", { amount: formatTwd(budgetTotal, locale) })}</span></div>}
    {entries.length === 0 ? <div className={styles.empty}><b>{t("noPlan")}</b><p>{t("noPlanHint")}</p></div> : <ol>
      {entries.map((entry, index) => {
        const record = recordsById.get(entry.circleId);
        if (!record) return null;
        const purchaseEditorVisible = variant === "full" || editingPurchaseId === entry.circleId;
        const purchaseSummary = [entry.purchaseMemo.trim(), entry.budget !== null ? formatTwd(entry.budget, locale) : ""].filter(Boolean).join(" · ");
        return <li key={entry.circleId} draggable={!purchaseEditorVisible} onDragStart={(event) => { setDraggingId(entry.circleId); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", entry.circleId); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const circleId = draggingId ?? event.dataTransfer.getData("text/plain"); if (circleId) onMoveTo(circleId, index); setDraggingId(null); }} onDragEnd={() => setDraggingId(null)} className={`${entry.status === "next" ? styles.next : entry.status === "visited" ? styles.visited : ""} ${draggingId === entry.circleId ? styles.dragging : ""}`}>
          <div className={styles.itineraryRow}><span className={styles.dragHandle} aria-hidden="true"><UiIcon name="drag" /></span><button className={styles.planMain} onClick={() => onSelect(record)}><span>{index + 1}</span><div><b>{record.code} · {record.name}</b><small>{[entry.status === "next" ? t("next") : entry.status === "visited" ? t("visited") : t("planned"), placementStatusLabel(record.placement.status, locale)].filter(Boolean).join(" · ")}</small></div></button>
            <div className={styles.planActions}>
              <button disabled={index === 0} onClick={() => onMove(entry.circleId, -1)} aria-label={t("moveUp", { name: record.name })}><UiIcon name="arrow-up" /></button>
              <button disabled={index === entries.length - 1} onClick={() => onMove(entry.circleId, 1)} aria-label={t("moveDown", { name: record.name })}><UiIcon name="arrow-down" /></button>
              <button className={styles.visitToggle} aria-pressed={entry.status === "visited"} aria-label={entry.status === "visited" ? t("markPlanned", { name: record.name }) : t("markVisited", { name: record.name })} onClick={() => onVisit(entry)}><UiIcon name={entry.status === "visited" ? "check-square" : "square"} /></button>
              <button onClick={() => onRemove(entry.circleId)} aria-label={t("removeFromPlan", { name: record.name })}><UiIcon name="close" /></button>
            </div>
          </div>
          {variant === "compact" && <button type="button" className={styles.purchaseToggle} aria-expanded={purchaseEditorVisible} onClick={() => setEditingPurchaseId((current) => current === entry.circleId ? null : entry.circleId)}><span>{purchaseSummary || t("addPurchase")}</span><b>{purchaseEditorVisible ? t("collapse") : purchaseSummary ? t("edit") : t("add")}</b></button>}
          {purchaseEditorVisible && <div className={styles.purchaseEditor}>
            <label><span>{t("purchaseItems")}</span><textarea value={entry.purchaseMemo} onChange={(event) => onUpdatePurchase(entry.circleId, event.target.value, entry.budget)} placeholder={t("purchasePlaceholder")} /></label>
            <label><span>{t("budget")}</span><input type="number" inputMode="numeric" min="0" step="1" value={entry.budget ?? ""} onChange={(event) => onUpdatePurchase(entry.circleId, entry.purchaseMemo, event.target.value === "" ? null : Number(event.target.value))} placeholder="0" /></label>
          </div>}
        </li>;
      })}
    </ol>}
  </section>;
}

export function CircleMediaGallery({ media, activeIndex: requestedIndex, compact, readOnly = false, locale = "zh-Hant", onActiveIndex, onOpenFull }: {
  media: CircleMedia[];
  activeIndex: number;
  compact: boolean;
  readOnly?: boolean;
  /** Given by `CircleDetails`, which reads it from context. */
  locale?: Locale;
  onActiveIndex: (index: number) => void;
  onOpenFull?: () => void;
}) {
  // The list can shrink under a stored selection — an author removing the
  // page they were looking at in the portal preview — so every part of the
  // gallery reads the same clamped position.
  const activeIndex = Math.max(0, Math.min(requestedIndex, media.length - 1));
  const activeMedia = media[activeIndex];
  if (!activeMedia) return null;
  // A side panel shows a sale-sheet page at card size, so it loads the card
  // preview; the full view loads the page itself.
  const image = <img src={compact ? activeMedia.previewUrl ?? activeMedia.url : activeMedia.url} alt={mediaAltLabel(activeMedia, locale)} referrerPolicy="no-referrer" loading={compact ? "lazy" : undefined} />;
  const move = (delta: number) => onActiveIndex((activeIndex + delta + media.length) % media.length);
  const t = (key: keyof (typeof MESSAGES)["zh-Hant"], params?: MessageParams) => translate(MESSAGES, locale, key, params);
  return <div className={`${styles.mediaGallery} ${compact ? styles.compactGallery : styles.fullGallery}`} role="group" aria-label={t("circleImages")}>
    {compact && onOpenFull
      ? <button className={styles.galleryOpen} disabled={readOnly} onClick={onOpenFull} aria-label={t("openFullFor", { alt: mediaAltLabel(activeMedia, locale) })}>{image}</button>
      : <div className={styles.galleryFrame}>
        {/* In the full view a sale-sheet page is its own way to the original,
            where the browser can zoom: tap the page, not a link beside it. */}
        {!compact && activeMedia.kind === "catalog"
          ? <a className={styles.galleryZoom} href={activeMedia.url} target="_blank" rel="noreferrer" aria-label={t("openOriginal", { alt: mediaAltLabel(activeMedia, locale) })} aria-disabled={readOnly || undefined} tabIndex={readOnly ? -1 : undefined} onClick={readOnly ? preventLinkActivation : undefined}>{image}</a>
          : image}
      </div>}
    {!compact && <div className={styles.galleryFooter}>
      {media.length > 1 && <div className={styles.galleryControls} role="group" aria-label={t("slideshow")}>
        <button type="button" disabled={readOnly} onClick={() => move(-1)} aria-label={t("previousImage")}><UiIcon name="chevron-left" /></button>
        <div><span aria-live="polite">{activeIndex + 1} / {media.length}</span><div className={styles.galleryRail}>{media.map((item, index) => <button type="button" disabled={readOnly} key={item.id} className={index === activeIndex ? styles.activeMedia : ""} onClick={() => onActiveIndex(index)} aria-label={t("showImage", { index: index + 1 })} aria-pressed={index === activeIndex}><img src={item.previewUrl ?? item.url} alt="" referrerPolicy="no-referrer" loading="lazy" /></button>)}</div></div>
        <button type="button" disabled={readOnly} onClick={() => move(1)} aria-label={t("nextImage")}><UiIcon name="chevron-right" /></button>
      </div>}
      {/* Provenance is optional on a circle's own upload (ADR-0053). With no
          link there is nothing to point at, so the row shows the credit alone —
          and nothing at all when there is no credit either (ADR-0036). */}
      {/* A sale-sheet page is the circle's own and has no other source to
          credit; the page itself opens the original, so its row stays empty. */}
      {activeMedia.kind === "catalog" ? null
        : activeMedia.sourceUrl
          ? <a className={styles.mediaSource} href={activeMedia.sourceUrl} target="_blank" rel="noreferrer" aria-disabled={readOnly || undefined} tabIndex={readOnly ? -1 : undefined} onClick={readOnly ? preventLinkActivation : undefined}><span>{activeMedia.provider}</span><span>{t("originalSource")}</span><UiIcon name="external" /></a>
          : activeMedia.provider ? <div className={styles.mediaSource}><span>{activeMedia.provider}</span></div> : null}
    </div>}
  </div>;
}

function preventLinkActivation(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
}

export function CircleDetails({ record, sharedRecords, movedDestination = null, favorite, plan, groups, compact = false, readOnly = false, embedded = false, floating = false, onClose, onOpenFull, onSelectShared, onToggleFavorite, onTogglePlan, onSetNext, onUpdateFavorite, onCreateGroup }: {
  record: CircleViewRecord | null;
  sharedRecords: CircleViewRecord[];
  /** The circle's live booth in this event, when the organizer's data has one. */
  movedDestination?: CircleViewRecord | null;
  favorite: FavoriteRecord | null;
  plan: VisitPlanEntry | null;
  groups: FavoriteGroup[];
  compact?: boolean;
  embedded?: boolean;
  floating?: boolean;
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
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);
  if (!record) return <section className={styles.detailEmpty} aria-label={t("boothDetails")}><span><UiIcon name="map-pin" /></span><b>{t("chooseBooth")}</b></section>;
  const activeMediaIndex = mediaSelection.circleId === record.circle.id ? mediaSelection.index : 0;
  const visibleLinks = compact ? record.circle.externalLinks.slice(0, 6) : record.circle.externalLinks;
  const gallery = <CircleMediaGallery media={record.circle.media} activeIndex={activeMediaIndex} compact={compact} readOnly={readOnly} locale={locale} onActiveIndex={(index) => setMediaSelection({ circleId: record.circle.id, index })} onOpenFull={onOpenFull} />;
  const header = <div className={styles.detailHeader}><div className={styles.placementMeta} aria-label={t("placement", { code: record.code, day: record.day })}><strong className={styles[record.tone]}>{record.code}</strong><span>DAY {record.day}</span><span>{t("allAreas")}</span></div>{!embedded && <button className={styles.detailClose} disabled={readOnly} onClick={onClose} aria-label={t("closeDetails")} data-details-close><UiIcon name="close" /></button>}</div>;
  const title = <div className={styles.title}><div><h2>{record.name}</h2>{(record.circle.circleCategory || record.circle.creatorTypes.length > 0 || record.circle.pen) && <p>{[record.circle.circleCategory, optionList(record.circle.creatorTypes, locale, t("listSeparator")), record.circle.pen].filter(Boolean).join(" · ")}</p>}{record.circle.ageRatings.length > 0 && <small className={styles.rating}>{t("rating", { ratings: optionList(record.circle.ageRatings, locale, t("listSeparator")) })}</small>}</div><button className={`${styles.heart} ${favorite ? styles.saved : ""}`} disabled={readOnly} onClick={onToggleFavorite} aria-label={favorite ? t("unfavorite") : t("favorite")}><UiIcon name="heart" /></button></div>;
  const actions = <div className={styles.detailActions}><button className={styles.primary} disabled={readOnly} onClick={onTogglePlan}>{plan ? t("removePlan") : t("addPlan")}</button><button disabled={readOnly || plan?.status === "next"} onClick={onSetNext}>{plan?.status === "next" ? t("currentNext") : t("setNext")}</button></div>;
  const retiredNotice = record.placement.status !== "active" && <div className={styles.retiredNotice} role="status">
        <b>{placementStatusLabel(record.placement.status, locale)}</b>
        <p>{record.placement.status === "cancelled"
          ? t("cancelledNotice")
          : movedDestination
            ? t("movedTo", { day: movedDestination.day, code: movedDestination.code })
            : t("movedUnknown")}</p>
        {record.placement.status === "moved" && movedDestination && <button type="button" disabled={readOnly} onClick={() => onSelectShared(movedDestination)}>{t("seeNewBooth", { code: movedDestination.code })}</button>}
      </div>;
  const body = <div className={styles.detailBody}>
      {!floating && header}
      {!floating && retiredNotice}
      {!floating && title}
      {favorite?.groupId && <p className={styles.sourceHint}>{t("favoriteGroupOf", { name: groups.find((group) => group.id === favorite.groupId)?.name ?? t("ungrouped") })}</p>}
      {sharedRecords.length > 1 && <div className={styles.shared}><small>{t("sharedBooth", { count: sharedRecords.length })}</small>{sharedRecords.map((item) => <button key={item.recordId} disabled={readOnly} className={item.recordId === record.recordId ? styles.activeShared : ""} onClick={() => onSelectShared(item)}><b>{item.name}</b><span>{item.genre}</span></button>)}</div>}
      {!compact && <div className={styles.tags}>{[...new Set([...record.circle.workTypes.map((type) => circleOptionLabel(type, locale)), ...record.circle.referencedWorks, ...record.circle.specialTags, ...record.tags.map((tag) => tag.trim())])].filter(Boolean).map((tag) => <span key={tag}>#{tag}</span>)}</div>}
      {(record.circle.work || record.circle.saleInfo || record.note) && <div className={styles.work}><small>{t("workAndSales")}</small>{record.circle.work && <b>{record.circle.work}</b>}{(record.circle.saleInfo || record.note) && <p>{record.circle.saleInfo || record.note}</p>}</div>}
      {visibleLinks.length > 0 && <div className={styles.externalLinks} aria-label={t("externalLinks")}><b>{t("moreInfo")}</b><div>{visibleLinks.map((link) => <a key={`${link.kind}-${link.provider}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" aria-disabled={readOnly || undefined} tabIndex={readOnly ? -1 : undefined} onClick={readOnly ? preventLinkActivation : undefined}><span>{link.provider}</span><small>{linkKindLabel(link.kind, locale)}</small><UiIcon name="external" /></a>)}</div>{compact && record.circle.externalLinks.length > visibleLinks.length && <small>{t("moreLinks", { count: record.circle.externalLinks.length - visibleLinks.length })}</small>}</div>}
      {!floating && actions}
      {compact && <><div className={styles.sourceSummary}><b>{t("sources")}</b><span>{record.sources.map((source) => sourceProviderLabel(source, locale)).join(locale === "en" ? ", " : "、")}</span></div><button className={styles.fullDetailButton} disabled={readOnly} onClick={onOpenFull}>{t("openFull")}</button></>}
      {!compact && favorite && <div className={styles.favoriteEditor}>
        <label>{t("favoriteGroup")}<select disabled={readOnly} value={favorite.groupId ?? ""} onChange={(event) => onUpdateFavorite(event.target.value || null, favorite.memo)}><option value="">{t("ungrouped")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>{t("memo")}<textarea disabled={readOnly} value={favorite.memo} onChange={(event) => onUpdateFavorite(favorite.groupId, event.target.value)} placeholder={t("memoPlaceholder")} /></label>
        <div className={styles.groupCreator}><input disabled={readOnly} value={newGroup} onChange={(event) => setNewGroup(event.target.value)} placeholder={t("newGroup")} /><button disabled={readOnly || !newGroup.trim()} onClick={() => { onCreateGroup(newGroup); setNewGroup(""); }}>{t("add")}</button></div>
      </div>}
      {!compact && <div className={styles.sources} aria-label={t("sources")}>
        <b>{t("sources")}</b>
        {record.sources.map((source) => <div key={`${source.provider}-${source.contentType}`}><span><strong>{sourceProviderLabel(source, locale)}</strong>{source.label && <small>{sourceTitleLabel(source, locale)}</small>}{SOURCE_STATUS_NOTE[source.status] && <small>{t(SOURCE_STATUS_NOTE[source.status]!)}</small>}<small>{sourceDateLabel(source, locale)}</small></span>{source.url && <a href={source.url} target="_blank" rel="noreferrer" aria-disabled={readOnly || undefined} tabIndex={readOnly ? -1 : undefined} onClick={readOnly ? preventLinkActivation : undefined}>{t("originalSource")} <UiIcon name="external" /></a>}</div>)}
      </div>}
      {(floating || embedded) && !readOnly && <p className={styles.claimEntry}>{t("claimQuestion")}<a href={localizedHref(`/circle?${new URLSearchParams({ event: record.placement.eventId, circle: record.circle.id })}`, locale)}>{t("claim")}</a></p>}
    </div>;
  // The scroll region must be reachable with Tab so keyboard users can scroll it.
  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
  const floatingContent = <div className={styles.floatingContent} key={record.recordId} role="region" aria-label={t("circleContent")} tabIndex={0}>{gallery}{body}</div>;
  return <section className={`${styles.details} ${compact ? styles.compactDetails : styles.fullDetails} ${record.circle.media.length > 0 ? styles.detailsWithMedia : ""} ${floating ? styles.floatingDetails : ""}`} data-embedded={embedded || undefined} aria-label={t("boothDetails")}>
    {floating ? <><div className={styles.floatingHeader}>{header}{title}{retiredNotice}{actions}</div>{floatingContent}</> : <>{gallery}{body}</>}
  </section>;
}
