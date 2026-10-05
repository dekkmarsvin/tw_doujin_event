"use client";

import { useEffect, useRef, useState } from "react";
import { localizedHref } from "./i18n/locale";
import { useLocale, useMessages } from "./i18n/locale-context";
import { defineMessages } from "./i18n/messages";
import { UiIcon } from "./ui-icons";
import styles from "./reader-help.module.css";

const MESSAGES = defineMessages({
  "zh-Hant": {
    help: "使用說明",
    close: "關閉使用說明",
    searchTitle: "找社團與作品",
    search: "輸入社團、攤位或作品；「詳細搜尋」可再依創作內容、作品取向與分級篩選。按 Ctrl/Command + K 可直接聚焦搜尋欄。",
    mapTitle: "查看攤位",
    map: "拖曳、縮放或重設地圖位置。鍵盤使用者可進入地圖後以方向鍵移動，按 Enter 或空白鍵開啟攤位。",
    planTitle: "收藏與安排行程",
    plan: "行程建立後可使用「導航模式」只看當日預定攤位並標記已走訪。",
    offlineTitle: "離線使用",
    offline: "開過的活動，斷網後仍可查看場刊與地圖；社團自填內容、品書圖與外部連結需要網路。",
    checkOffline: "確認這天可離線使用",
    backupTitle: "完整備份",
    backup: "收藏、備註、群組、購買項目與預算只存在此瀏覽器。在「資料管理」匯出備份；換瀏覽器或裝置時用「從備份復原」。",
    circleTitle: "你是參展社團嗎？",
    circleBefore: "到",
    circleLink: "社團資料",
    circleAfter: "認領後，可以補上品書、販售資訊與連結。",
    whatYouCanDo: "看看能做什麼",
    organizerTitle: "你是活動主辦嗎？",
    organizer: "建立活動、匯入攤位名單並畫出攤位地圖。",
    about: "關於本頁",
    updated: "資料最後更新",
    contact: "聯絡",
  },
  en: {
    help: "Help",
    close: "Close help",
    searchTitle: "Find circles and works",
    search: "Search by circle, booth or work. “Advanced search” narrows results by creator type, audience and age rating. Press Ctrl/Command + K to jump to the search box.",
    mapTitle: "View booths",
    map: "Drag, zoom or reset the map. With a keyboard, move into the map, use the arrow keys to move between booths and press Enter or Space to open one.",
    planTitle: "Favorites and plans",
    plan: "Once you have a plan, “Navigation mode” shows only the day’s planned booths and lets you mark them visited.",
    offlineTitle: "Offline use",
    offline: "Events you have opened can still show their catalog and map offline. Circle-added details, item list images and external links need a connection.",
    checkOffline: "Check this day works offline",
    backupTitle: "Full backup",
    backup: "Favorites, notes, groups, items to buy and budgets are stored only in this browser. Export a backup from “Manage data”, and use “Restore from backup” on another browser or device.",
    circleTitle: "Are you an exhibiting circle?",
    circleBefore: "Claim your circle in ",
    circleLink: "Circle workspace",
    circleAfter: " to add your item list, sales info and links. ",
    whatYouCanDo: "See what you can do",
    organizerTitle: "Are you an event organizer?",
    organizer: "Create events, import booth lists and draw booth maps. ",
    about: "About this page",
    updated: "Data last updated",
    contact: "Contact",
  },
  ja: {
    help: "使い方",
    close: "使い方を閉じる",
    searchTitle: "サークルと作品を探す",
    search: "サークル名、スペース、作品で検索できます。「詳細検索」では創作ジャンル、作品の傾向、年齢区分で絞り込めます。Ctrl/Command + K で検索欄に移動します。",
    mapTitle: "スペースを見る",
    map: "マップはドラッグ、拡大・縮小、位置のリセットができます。キーボードではマップに移動して矢印キーで移動し、Enter キーまたはスペースキーでスペースを開きます。",
    planTitle: "お気に入りと巡回プラン",
    plan: "巡回プランを作ると、「ナビゲーションモード」でその日の予定スペースだけを表示し、訪問済みにできます。",
    offlineTitle: "オフライン利用",
    offline: "一度開いたイベントは、オフラインでもカタログとマップを見られます。サークル記入の情報、お品書き画像、外部リンクにはネット接続が必要です。",
    checkOffline: "この日をオフラインで使えるか確認",
    backupTitle: "バックアップ",
    backup: "お気に入り、メモ、グループ、購入予定、予算はこのブラウザにのみ保存されます。「データ管理」でバックアップを書き出し、ブラウザや端末を変えるときは「バックアップから復元」を使ってください。",
    circleTitle: "サークル参加の方ですか？",
    circleBefore: "",
    circleLink: "サークル管理",
    circleAfter: "で管理申請すると、お品書き、頒布情報、リンクを追加できます。",
    whatYouCanDo: "できることを見る",
    organizerTitle: "イベント主催者の方ですか？",
    organizer: "イベントの作成、スペース一覧の取り込み、配置マップの作成ができます。",
    about: "このページについて",
    updated: "データ最終更新",
    contact: "連絡先",
  },
});

export default function ReaderHelp({ eventId, dataLastUpdatedLabel, onCheckOffline }: { eventId: string; dataLastUpdatedLabel: string; onCheckOffline?: () => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);

  useEffect(() => {
    if (!open) return;
    const close = (restoreFocus = false) => {
      setOpen(false);
      if (restoreFocus) requestAnimationFrame(() => buttonRef.current?.focus());
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return <div ref={menuRef} className={styles.menu}>
    <button
      ref={buttonRef}
      type="button"
      className={`${styles.trigger} help`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="reader-help"
      onClick={() => setOpen((current) => !current)}
    >{t("help")}</button>
    {open && <section id="reader-help" className={styles.panel} role="dialog" aria-labelledby="reader-help-title">
      <header>
        <h2 id="reader-help-title">{t("help")}</h2>
        <button type="button" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} aria-label={t("close")}><UiIcon name="close" /></button>
      </header>
      <ol className={styles.steps}>
        <li><strong>{t("searchTitle")}</strong><span>{t("search")}</span></li>
        <li><strong>{t("mapTitle")}</strong><span>{t("map")}</span></li>
        <li><strong>{t("planTitle")}</strong><span>{t("plan")}</span></li>
        <li><strong>{t("offlineTitle")}</strong><span>{t("offline")}{onCheckOffline && <button type="button" className={styles.inlineAction} onClick={() => { setOpen(false); onCheckOffline(); }}>{t("checkOffline")}</button>}</span></li>
        <li><strong>{t("backupTitle")}</strong><span>{t("backup")}</span></li>
      </ol>
      <section className={styles.circleEntry} aria-labelledby="reader-circle-entry-title">
        <h3 id="reader-circle-entry-title">{t("circleTitle")}</h3>
        {/* Names the event on screen: without it the portal opens on the last event
            this browser maintained, or the nearest by date, not the one being read. */}
        <p>{t("circleBefore")}<a href={localizedHref(`/circle?${new URLSearchParams({ event: eventId })}`, locale)}>{t("circleLink")}</a>{t("circleAfter")}<a href={localizedHref("/portal/#circle", locale)}>{t("whatYouCanDo")}</a></p>
      </section>
      <section className={styles.circleEntry} aria-labelledby="reader-organizer-entry-title">
        <h3 id="reader-organizer-entry-title">{t("organizerTitle")}</h3>
        <p>{t("organizer")}<a href={localizedHref("/portal/#organizer", locale)}>{t("whatYouCanDo")}</a></p>
      </section>
      <section className={styles.about} aria-labelledby="reader-about-title">
        <h3 id="reader-about-title">{t("about")}</h3>
        <dl><div><dt>{t("updated")}</dt><dd>{dataLastUpdatedLabel}</dd></div><div><dt>{t("contact")}</dt><dd>Discord ID <strong>dekkorakki</strong></dd></div></dl>
      </section>
    </section>}
  </div>;
}
