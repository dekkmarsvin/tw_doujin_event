"use client";

import { useRef, useState } from "react";
import { useMessages } from "./i18n/locale-context";
import { defineMessages } from "./i18n/messages";
import type { FavoriteGroup } from "./planning-store";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import styles from "./display-filter-controls.module.css";

export type PlanningDisplayFilters = {
  favoriteGroupId: string;
  visitStatus: "ALL" | "planned" | "next" | "visited" | "not-planned";
  sort: "booth" | "name" | "updated";
  density: "compact" | "informative";
  mediaCount: 0 | 1 | 3;
};

const MESSAGES = defineMessages({
  "zh-Hant": {
    title: "行程、收藏與顯示",
    dialog: "行程、收藏與顯示設定",
    cancelClose: "取消並關閉",
    group: "收藏群組",
    allGroups: "全部群組",
    ungrouped: "未分組",
    visit: "行程狀態",
    allStatuses: "全部狀態",
    next: "下一站",
    planned: "待前往",
    visited: "已走訪",
    notPlanned: "未加入行程",
    sort: "結果排序",
    byBooth: "攤位編號",
    byName: "社團名稱",
    byUpdated: "最近更新",
    density: "資訊密度",
    compact: "精簡",
    informative: "資訊",
    media: "每筆媒體",
    noMedia: "不顯示",
    oneMedia: "1 張",
    threeMedia: "最多 3 張",
    cancel: "取消",
    apply: "套用",
  },
  en: {
    title: "Plan, favorites & display",
    dialog: "Plan, favorites & display settings",
    cancelClose: "Cancel and close",
    group: "Favorite group",
    allGroups: "All groups",
    ungrouped: "Ungrouped",
    visit: "Plan status",
    allStatuses: "All statuses",
    next: "Next stop",
    planned: "To visit",
    visited: "Visited",
    notPlanned: "Not in plan",
    sort: "Sort by",
    byBooth: "Booth No.",
    byName: "Circle name",
    byUpdated: "Recently updated",
    density: "Detail level",
    compact: "Compact",
    informative: "Detailed",
    media: "Images per result",
    noMedia: "None",
    oneMedia: "1",
    threeMedia: "Up to 3",
    cancel: "Cancel",
    apply: "Apply",
  },
  ja: {
    title: "巡回プラン・お気に入り・表示",
    dialog: "巡回プラン・お気に入り・表示の設定",
    cancelClose: "キャンセルして閉じる",
    group: "お気に入りグループ",
    allGroups: "すべてのグループ",
    ungrouped: "未分類",
    visit: "巡回状況",
    allStatuses: "すべての状況",
    next: "次の行き先",
    planned: "未訪問",
    visited: "訪問済み",
    notPlanned: "プラン外",
    sort: "並び順",
    byBooth: "スペース番号",
    byName: "サークル名",
    byUpdated: "更新順",
    density: "表示密度",
    compact: "コンパクト",
    informative: "詳細",
    media: "1件あたりの画像",
    noMedia: "表示しない",
    oneMedia: "1枚",
    threeMedia: "最大3枚",
    cancel: "キャンセル",
    apply: "適用",
  },
});

export const DEFAULT_PLANNING_DISPLAY_FILTERS: PlanningDisplayFilters = {
  favoriteGroupId: "ALL",
  visitStatus: "ALL",
  sort: "booth",
  density: "informative",
  mediaCount: 0,
};

export default function PlanningDisplayControls({ value, groups, onApply }: {
  value: PlanningDisplayFilters;
  groups: FavoriteGroup[];
  onApply: (next: PlanningDisplayFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const panelRef = useRef<HTMLElement | null>(null);
  const t = useMessages(MESSAGES);
  const activeCount = Number(value.favoriteGroupId !== "ALL") + Number(value.visitStatus !== "ALL") + Number(value.sort !== "booth") + Number(value.density !== "informative") + Number(value.mediaCount !== 0);
  /** Closing without applying is a cancel, so the draft goes back to the applied value. */
  const cancel = () => { setDraft(value); setOpen(false); };
  useModalFocus(open, panelRef, cancel);

  return <div className={styles.wrap}>
    <button type="button" className={styles.trigger} onClick={() => { setDraft(value); setOpen(true); }}>{t("title")}{activeCount > 0 && <span>{activeCount}</span>}</button>
    {open && <section ref={panelRef} className={styles.panel} role="dialog" aria-modal="true" aria-label={t("dialog")} tabIndex={-1}>
      <header><b>{t("title")}</b><button type="button" onClick={cancel} aria-label={t("cancelClose")}><UiIcon name="close" /></button></header>
      <label>{t("group")}<select value={draft.favoriteGroupId} onChange={(event) => setDraft({ ...draft, favoriteGroupId: event.target.value })}><option value="ALL">{t("allGroups")}</option><option value="UNGROUPED">{t("ungrouped")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label>{t("visit")}<select value={draft.visitStatus} onChange={(event) => setDraft({ ...draft, visitStatus: event.target.value as PlanningDisplayFilters["visitStatus"] })}><option value="ALL">{t("allStatuses")}</option><option value="next">{t("next")}</option><option value="planned">{t("planned")}</option><option value="visited">{t("visited")}</option><option value="not-planned">{t("notPlanned")}</option></select></label>
      <label>{t("sort")}<select value={draft.sort} onChange={(event) => setDraft({ ...draft, sort: event.target.value as PlanningDisplayFilters["sort"] })}><option value="booth">{t("byBooth")}</option><option value="name">{t("byName")}</option><option value="updated">{t("byUpdated")}</option></select></label>
      <fieldset><legend>{t("density")}</legend><div className={styles.segments}><button type="button" className={draft.density === "compact" ? styles.active : ""} onClick={() => setDraft({ ...draft, density: "compact" })}>{t("compact")}</button><button type="button" className={draft.density === "informative" ? styles.active : ""} onClick={() => setDraft({ ...draft, density: "informative" })}>{t("informative")}</button></div></fieldset>
      <label>{t("media")}<select value={draft.mediaCount} onChange={(event) => setDraft({ ...draft, mediaCount: Number(event.target.value) as 0 | 1 | 3 })}><option value={0}>{t("noMedia")}</option><option value={1}>{t("oneMedia")}</option><option value={3}>{t("threeMedia")}</option></select></label>
      <footer><button type="button" onClick={cancel}>{t("cancel")}</button><button type="button" className={styles.apply} onClick={() => { onApply(draft); setOpen(false); }}>{t("apply")}</button></footer>
    </section>}
  </div>;
}
