"use client";

import { useId, useMemo, useRef, useState } from "react";
import { circlePromotion } from "../circle-share";
import type { EventDefinition } from "../event-catalog";
import type { CircleViewRecord } from "../circle-records";
import styles from "./portal.module.css";

/**
 * Where a circle takes its page once something is published: open it, copy a
 * ready-made post, or hand it to the device's share sheet.
 *
 * The text is shown in a read-only box, not only behind a button, because a
 * clipboard can refuse — and then the author still has the words in front of
 * them, already selected, to copy by hand.
 */
export function CirclePageShare({ event, circle, records }: {
  event: EventDefinition;
  circle: { id: string; name: string };
  records: CircleViewRecord[] | null;
}) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [result, setResult] = useState("");
  // Booths come from the official records the preview already loaded; before
  // they arrive the post still names the circle, the event and the address.
  const promotion = useMemo(
    () => circlePromotion(event, circle, (records ?? []).map((record) => record.placement), window.location.origin),
    [circle, event, records],
  );
  const canShare = typeof navigator.share === "function";

  const selectText = () => {
    box.current?.focus();
    box.current?.select();
  };
  const copy = () => {
    void navigator.clipboard.writeText(promotion.full)
      .then(() => setResult("已複製宣傳文字與連結。"))
      .catch(() => {
        selectText();
        setResult("無法自動複製，文字已選取，請自行複製。");
      });
  };
  const share = () => {
    void navigator.share({ title: circle.name, text: promotion.text, url: promotion.url })
      .then(() => setResult(""))
      // Closing the share sheet is a choice, not a failure.
      .catch((error: unknown) => setResult(error instanceof DOMException && error.name === "AbortError" ? "" : "無法開啟分享，請改用複製。"));
  };

  return <section className={styles.sharePanel} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>分享公開頁</h3>
    <label htmlFor={`${id}-text`}>宣傳文字</label>
    <textarea id={`${id}-text`} ref={box} readOnly rows={5} value={promotion.full} onFocus={(event) => event.currentTarget.select()} />
    <div className={styles.shareActions}>
      <a className={styles.shareLink} href={promotion.url} target="_blank" rel="noreferrer">查看公開頁</a>
      <button type="button" onClick={copy}>複製宣傳文字與連結</button>
      {canShare && <button type="button" className={styles.secondaryButton} onClick={share}>分享</button>}
    </div>
    <p className={styles.shareResult} role="status">{result}</p>
  </section>;
}
