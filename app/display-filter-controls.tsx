"use client";

import { useState } from "react";
import type { FavoriteGroup } from "./planning-store";
import { UiIcon } from "./ui-icons";
import styles from "./display-filter-controls.module.css";

export type AdvancedFilters = {
  favoriteGroupId: string;
  visitStatus: "ALL" | "planned" | "next" | "visited" | "not-planned";
  sort: "booth" | "name" | "updated";
  density: "compact" | "informative";
  mediaCount: 0 | 1 | 3;
};

export const DEFAULT_ADVANCED_FILTERS: AdvancedFilters = {
  favoriteGroupId: "ALL",
  visitStatus: "ALL",
  sort: "booth",
  density: "informative",
  mediaCount: 0,
};

export default function DisplayFilterControls({ value, groups, onApply }: {
  value: AdvancedFilters;
  groups: FavoriteGroup[];
  onApply: (next: AdvancedFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const activeCount = Number(value.favoriteGroupId !== "ALL") + Number(value.visitStatus !== "ALL") + Number(value.sort !== "booth") + Number(value.density !== "informative");

  return <div className={styles.wrap}>
    <button className={styles.trigger} onClick={() => { setDraft(value); setOpen(true); }}>進階篩選與顯示{activeCount > 0 && <span>{activeCount}</span>}</button>
    {open && <section className={styles.panel} role="dialog" aria-modal="false" aria-label="進階篩選與顯示設定">
      <header><b>進階篩選與顯示</b><button onClick={() => setOpen(false)} aria-label="取消並關閉"><UiIcon name="close" /></button></header>
      <label>收藏群組<select value={draft.favoriteGroupId} onChange={(event) => setDraft({ ...draft, favoriteGroupId: event.target.value })}><option value="ALL">全部群組</option><option value="UNGROUPED">未分組</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label>行程狀態<select value={draft.visitStatus} onChange={(event) => setDraft({ ...draft, visitStatus: event.target.value as AdvancedFilters["visitStatus"] })}><option value="ALL">全部狀態</option><option value="next">下一站</option><option value="planned">待前往</option><option value="visited">已走訪</option><option value="not-planned">未加入行程</option></select></label>
      <label>結果排序<select value={draft.sort} onChange={(event) => setDraft({ ...draft, sort: event.target.value as AdvancedFilters["sort"] })}><option value="booth">攤位編號</option><option value="name">社團名稱</option><option value="updated">最近更新</option></select></label>
      <fieldset><legend>資訊密度</legend><div className={styles.segments}><button className={draft.density === "compact" ? styles.active : ""} onClick={() => setDraft({ ...draft, density: "compact" })}>精簡</button><button className={draft.density === "informative" ? styles.active : ""} onClick={() => setDraft({ ...draft, density: "informative" })}>資訊</button></div></fieldset>
      <label>每筆媒體<select value={draft.mediaCount} onChange={(event) => setDraft({ ...draft, mediaCount: Number(event.target.value) as 0 | 1 | 3 })}><option value={0}>不顯示</option><option value={1}>1 張</option><option value={3}>最多 3 張</option></select><small>目前資料沒有具來源與授權資訊的圖片，因此不會顯示媒體。</small></label>
      <footer><button onClick={() => { setDraft(value); setOpen(false); }}>取消</button><button className={styles.apply} onClick={() => { onApply(draft); setOpen(false); }}>套用</button></footer>
    </section>}
  </div>;
}
