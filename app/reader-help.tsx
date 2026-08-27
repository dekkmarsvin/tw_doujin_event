"use client";

import { useEffect, useRef, useState } from "react";
import { UiIcon } from "./ui-icons";
import styles from "./reader-help.module.css";

export default function ReaderHelp({ dataLastUpdatedLabel }: { dataLastUpdatedLabel: string }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

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
    >使用說明</button>
    {open && <section id="reader-help" className={styles.panel} role="dialog" aria-labelledby="reader-help-title">
      <header>
        <h2 id="reader-help-title">使用說明</h2>
        <button type="button" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} aria-label="關閉使用說明"><UiIcon name="close" /></button>
      </header>
      <ol className={styles.steps}>
        <li><strong>找社團與作品</strong><span>輸入社團、攤位或作品；「詳細搜尋」可再依創作者、作品類型與分級篩選。按 Ctrl/Command + K 可直接聚焦搜尋欄。</span></li>
        <li><strong>查看攤位</strong><span>拖曳、縮放或重設地圖位置。鍵盤使用者可進入地圖後以方向鍵移動，按 Enter 或空白鍵開啟攤位。</span></li>
        <li><strong>收藏與安排行程</strong><span>收藏、加入行程與設為下一站是三個獨立動作。行程建立後可使用「導航模式」只看當日預定攤位並標記已走訪。</span></li>
        <li><strong>備份本機資料</strong><span>收藏、備註、群組、購買項目與預算只存在此瀏覽器。「資料管理」可匯出 JSON 或 CSV；目前網頁尚未提供匯入。</span></li>
      </ol>
      <section className={styles.circleEntry} aria-labelledby="reader-circle-entry-title">
        <h3 id="reader-circle-entry-title">你是參展社團嗎？</h3>
        <p>到<a href="/circle">社團專區</a>驗證身分後，即可補充販售資訊、連結與代表圖。</p>
      </section>
      <section className={styles.about} aria-labelledby="reader-about-title">
        <h3 id="reader-about-title">關於本頁</h3>
        <p>本頁是非官方同人展逛攤工具，不代表 Fancy Frontier 主辦單位。</p>
        <dl><div><dt>資料最後更新</dt><dd>{dataLastUpdatedLabel}</dd></div><div><dt>聯絡</dt><dd>Discord ID <strong>dekkorakki</strong></dd></div></dl>
      </section>
    </section>}
  </div>;
}
