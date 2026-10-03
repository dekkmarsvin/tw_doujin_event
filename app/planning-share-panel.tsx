"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCircleCatalog } from "./circle-records";
import { PUBLISHED_EVENTS } from "./event-catalog";
import type { EventDayKey, PlanningDocument } from "./planning-store";
import {
  addSharedFavorites,
  addSharedToPlan,
  projectSharedList,
  readSharedListFromHash,
  resolveSharedList,
  sharedListFile,
  sharedListUrl,
  type SharedList,
} from "./planning-share";
import { downloadText } from "./download-text";
import { sharePublicContent } from "./public-share";
import { useCircleCatalog } from "./use-circle-catalog";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import styles from "./planning-tools.module.css";

export const OPEN_SHARED_LIST_EVENT = "planning-shared-list-open";

/** Shows a shared list read from a share file (#415); links arrive through the URL fragment. */
export function openSharedList(list: SharedList) {
  window.dispatchEvent(new CustomEvent<SharedList>(OPEN_SHARED_LIST_EVENT, { detail: list }));
}

const eventOf = (eventId: string) => PUBLISHED_EVENTS.find((event) => event.id === eventId);
function dayLabel(eventId: string, day: EventDayKey) {
  const found = eventOf(eventId)?.days.find((item) => String(item.id) === String(day));
  return found ? `${found.label}（${found.dateLabel}）` : `DAY ${day}`;
}
const itemKey = (item: { circleId: string; day: EventDayKey | null }) => `${item.circleId}\u0000${item.day ?? ""}`;

/** 分享我選的攤位: pick favorites and plan entries of this event, see what leaves, then share. */
export function SharePanel({ eventId, document }: { eventId: string; document: PlanningDocument }) {
  const catalog = getCircleCatalog(eventId);
  const name = (circleId: string) => {
    const record = catalog.recordsByCircleId.get(circleId)?.[0];
    return record ? `${record.placement.boothCode} ${record.circle.name}` : circleId;
  };
  const candidates = [
    ...document.visitPlans.filter((entry) => entry.eventId === eventId)
      .map((entry) => ({ circleId: entry.circleId, day: entry.day as EventDayKey | null, label: `${dayLabel(eventId, entry.day)} · ${name(entry.circleId)}` })),
    ...document.favorites.filter((favorite) => favorite.eventId === eventId)
      .map((favorite) => ({ circleId: favorite.circleId, day: null as EventDayKey | null, label: `收藏 · ${name(favorite.circleId)}` })),
  ];
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const [link, setLink] = useState<{ list: SharedList; url: string; fits: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const selected = candidates.filter((item) => !unchecked.has(itemKey(item)));

  if (candidates.length === 0) return <section className={styles.section} aria-labelledby="planning-share-title">
    <div><h3 id="planning-share-title">分享我選的攤位</h3><p>這場活動還沒有收藏或行程可以分享。</p></div>
  </section>;

  function toggle(key: string) {
    setLink(null); setMessage("");
    setUnchecked((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  function create() {
    const list = projectSharedList(document, eventId, selected.map(({ circleId, day }) => ({ circleId, day })));
    setLink({ list, ...sharedListUrl(window.location.origin, list) });
    setMessage("");
  }
  async function share() {
    if (!link) return;
    const result = await sharePublicContent({ title: `${eventOf(eventId)?.name ?? eventId} 推薦攤位`, url: link.url });
    setMessage(result === "copied" ? "已複製連結。" : result === "manual" ? "請手動複製上方連結。" : "");
  }

  return <section className={styles.section} aria-labelledby="planning-share-title">
    <div>
      <h3 id="planning-share-title">分享我選的攤位</h3>
      <p>只分享攤位與日期，不含備註、群組、購買項目與預算。連結可被轉傳，無法撤回或更新。</p>
    </div>
    <fieldset className={styles.sharePick}>
      <legend>將分享 {selected.length} 個</legend>
      {candidates.map((item) => <label key={itemKey(item)}><input type="checkbox" checked={!unchecked.has(itemKey(item))} onChange={() => toggle(itemKey(item))} />{item.label}</label>)}
    </fieldset>
    <div className={styles.confirmActions}>
      <button className={styles.primary} disabled={selected.length === 0} onClick={create}>產生分享連結</button>
    </div>
    {link && (link.fits
      ? <div className={styles.shareLink}>
        <input readOnly aria-label="分享連結" value={link.url} onFocus={(event) => event.currentTarget.select()} />
        <button onClick={() => void share()}>分享</button>
      </div>
      : <div className={styles.shareLink}>
        <span>清單太長，無法放進連結。改用分享檔傳給對方，對方在「資料管理」選「匯入計畫」開啟。</span>
        <button onClick={() => downloadText(`場刊Map-分享清單-${eventId}.json`, sharedListFile(link.list), "application/json")}>下載分享檔</button>
      </div>)}
    {message && <p className={styles.okText} role="status">{message}</p>}
  </section>;
}

/**
 * A list someone shared, opened from `#share=` or a share file. Nothing is
 * written until the reader presses 加入收藏 or 加入行程 (#415, ADR-0079).
 */
export function SharedListDialog({ eventId, document, update, blocked }: {
  eventId: string;
  document: PlanningDocument;
  update: (change: (current: PlanningDocument) => PlanningDocument) => void;
  blocked: boolean;
}) {
  const [shared, setShared] = useState<{ list: SharedList } | { error: string } | null>(() => {
    const read = readSharedListFromHash(window.location.hash);
    return read === null ? null : read.ok ? { list: read.list } : { error: read.error };
  });
  const dialogRef = useRef<HTMLElement | null>(null);
  const close = () => {
    setShared(null);
    if (window.location.hash.includes("share=")) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  };
  useModalFocus(shared !== null, dialogRef, close);
  useEffect(() => {
    const open = (event: Event) => setShared({ list: (event as CustomEvent<SharedList>).detail });
    window.addEventListener(OPEN_SHARED_LIST_EVENT, open);
    return () => window.removeEventListener(OPEN_SHARED_LIST_EVENT, open);
  }, []);
  if (!shared) return null;
  return createPortal(<div className={styles.backdrop} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="shared-list-title" tabIndex={-1}>
      <header><div><h2 id="shared-list-title">朋友分享的攤位</h2></div><button onClick={close} aria-label="關閉分享清單"><UiIcon name="close" /></button></header>
      {"error" in shared
        ? <p className={styles.errorText} role="alert">這個分享連結無法開啟：{shared.error}</p>
        : <SharedListBody list={shared.list} eventId={eventId} document={document} update={update} blocked={blocked} />}
    </section>
  </div>, globalThis.document.body);
}

function SharedListBody({ list, eventId, document, update, blocked }: { list: SharedList; eventId: string; document: PlanningDocument; update: (change: (current: PlanningDocument) => PlanningDocument) => void; blocked: boolean }) {
  // Re-render when this event's catalog arrives, so items are not judged against an empty one.
  useCircleCatalog(list.eventId);
  const event = eventOf(list.eventId);
  const resolved = resolveSharedList(list);
  const usable = resolved.items.filter((item) => item.state === "available" || item.state === "moved");
  const [day, setDay] = useState<string>(() => String(event?.days[0]?.id ?? ""));
  const [message, setMessage] = useState("");

  if (!event) return <p className={styles.errorText} role="alert">這份清單的活動目前沒有公開。</p>;
  if (list.eventId !== eventId) return <div className={styles.section}><p>這份清單是「{event.name}」的攤位。</p>
    <a className={styles.linkButton} href={sharedListUrl(window.location.origin, list).url}>到 {event.name} 查看</a></div>;

  const circleIds = [...new Set(usable.map((item) => item.circleId))];
  const onDay = circleIds.filter((circleId) => usable.some((item) => item.circleId === circleId && item.records.some((record) => String(record.placement.day) === day)));
  return <>
    <p className={styles.notice}>先看看再決定；按下加入前不會改動你的收藏與行程。</p>
    {resolved.status !== "ready" && <p className={styles.notice} role="status">{resolved.status === "loading" ? "正在讀取活動資料…" : "活動資料讀取失敗，暫時無法核對這份清單。"}</p>}
    <ol className={styles.sharedItems}>{resolved.items.map((item) => <li key={itemKey(item)}>
      <b>{item.records[0] ? `${item.records[0].placement.boothCode} ${item.circle?.name ?? ""}` : item.circleId}</b>
      <small>{item.state === "available" ? (item.day === null ? "收藏" : dayLabel(list.eventId, item.day))
        : item.state === "moved" ? `已改到 ${item.days.map((value) => dayLabel(list.eventId, value)).join("、")}`
          : item.state === "withdrawn" ? "已取消參加" : "目前找不到這個社團"}</small>
    </li>)}</ol>
    {resolved.status === "ready" && <div className={styles.section}>
      <div className={styles.confirmActions}>
        <button disabled={blocked || circleIds.length === 0} onClick={() => {
          const { added } = addSharedFavorites(document, list.eventId, circleIds);
          update((current) => addSharedFavorites(current, list.eventId, circleIds).document);
          setMessage(added > 0 ? `已加入 ${added} 個收藏。` : "這些攤位都已在收藏裡。");
        }}>加入收藏</button>
        <select aria-label="加入哪一天的行程" value={day} onChange={(change) => { setDay(change.target.value); setMessage(""); }}>
          {event.days.map((item) => <option key={item.id} value={String(item.id)}>{item.label} · {item.dateLabel}</option>)}
        </select>
        <button className={styles.primary} disabled={blocked || onDay.length === 0} onClick={() => {
          const target = event.days.find((item) => String(item.id) === day)!.id;
          const { added } = addSharedToPlan(document, list.eventId, target, onDay);
          update((current) => addSharedToPlan(current, list.eventId, target, onDay).document);
          const skipped = circleIds.length - onDay.length;
          const note = skipped > 0 ? `；${skipped} 個這天沒有攤位，未加入` : "";
          setMessage(added > 0 ? `已加入 ${added} 筆到行程${note}。` : `這些攤位都已在這天的行程裡${note}。`);
        }}>加入行程</button>
      </div>
      {blocked && <p className={styles.errorText}>這台裝置有無法讀取的舊資料，請先在「資料管理」處理。</p>}
      {message && <p className={styles.okText} role="status">{message}</p>}
    </div>}
  </>;
}
