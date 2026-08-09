"use client";

import { useState } from "react";
import type { FavoriteGroup } from "./planning-store";
import { UiIcon } from "./ui-icons";
import styles from "./display-filter-controls.module.css";

export type PlanningDisplayFilters = {
  favoriteGroupId: string;
  visitStatus: "ALL" | "planned" | "next" | "visited" | "not-planned";
  sort: "booth" | "name" | "updated";
  density: "compact" | "informative";
  mediaCount: 0 | 1 | 3;
};

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
  const activeCount = Number(value.favoriteGroupId !== "ALL") + Number(value.visitStatus !== "ALL") + Number(value.sort !== "booth") + Number(value.density !== "informative") + Number(value.mediaCount !== 0);

  return <div className={styles.wrap}>
    <button className={styles.trigger} onClick={() => { setDraft(value); setOpen(true); }}>行程、收藏與顯示{activeCount > 0 && <span>{activeCount}</span>}</button>
    {open && <section className={styles.panel} role="dialog" aria-modal="false" aria-label="行程、收藏與顯示設定">
      <header><b>行程、收藏與顯示</b><button onClick={() => setOpen(false)} aria-label="取消並關閉"><UiIcon name="close" /></button></header>
      <label>收藏群組<select value={draft.favoriteGroupId} onChange={(event) => setDraft({ ...draft, favoriteGroupId: event.target.value })}><option value="ALL">全部群組</option><option value="UNGROUPED">未分組</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label>行程狀態<select value={draft.visitStatus} onChange={(event) => setDraft({ ...draft, visitStatus: event.target.value as PlanningDisplayFilters["visitStatus"] })}><option value="ALL">全部狀態</option><option value="next">下一站</option><option value="planned">待前往</option><option value="visited">已走訪</option><option value="not-planned">未加入行程</option></select></label>
      <label>結果排序<select value={draft.sort} onChange={(event) => setDraft({ ...draft, sort: event.target.value as PlanningDisplayFilters["sort"] })}><option value="booth">攤位編號</option><option value="name">社團名稱</option><option value="updated">最近更新</option></select></label>
      <fieldset><legend>資訊密度</legend><div className={styles.segments}><button className={draft.density === "compact" ? styles.active : ""} onClick={() => setDraft({ ...draft, density: "compact" })}>精簡</button><button className={draft.density === "informative" ? styles.active : ""} onClick={() => setDraft({ ...draft, density: "informative" })}>資訊</button></div></fieldset>
      <label>每筆媒體<select value={draft.mediaCount} onChange={(event) => setDraft({ ...draft, mediaCount: Number(event.target.value) as 0 | 1 | 3 })}><option value={0}>不顯示</option><option value={1}>1 張</option><option value={3}>最多 3 張</option></select><small>只顯示 FF47 公開縮圖索引中可追溯原始連結的圖片；沒有來源的社團維持文字卡。</small></label>
      <footer><button onClick={() => { setDraft(value); setOpen(false); }}>取消</button><button className={styles.apply} onClick={() => { onApply(draft); setOpen(false); }}>套用</button></footer>
    </section>}
  </div>;
}
