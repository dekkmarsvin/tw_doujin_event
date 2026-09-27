"use client";

import { useId, useMemo, useRef, useState } from "react";
import { circlePromotion } from "../circle-share";
import { circlePath } from "../seo";
import type { EventDefinition } from "../event-catalog";
import type { CircleViewRecord } from "../circle-records";
import styles from "./portal.module.css";

/**
 * A browser without the Clipboard API — an insecure page, an older engine —
 * has no `navigator.clipboard` at all, and reading `.writeText` off it throws
 * before any promise exists. Starting from a resolved promise turns that into
 * the same rejection a refused write gives, so one fallback handles both.
 */
export function writeClipboard(text: string) {
  return Promise.resolve().then(() => navigator.clipboard.writeText(text));
}

/**
 * Where a circle takes its page once something is published: open it, copy a
 * ready-made post, or hand it to the device's share sheet.
 *
 * The text is shown in a read-only box, not only behind a button, because a
 * clipboard can refuse — and then the author still has the words in front of
 * them, already selected, to copy by hand.
 *
 * The post is only offered once the official records have arrived: without
 * them it would go out with no date, booth or venue, which is most of what a
 * reader needs from it. Until then the page link still works.
 */
export function CirclePageShare({ event, circle, records, failed, onRetry }: {
  event: EventDefinition;
  circle: { id: string; name: string };
  records: CircleViewRecord[] | null;
  failed: boolean;
  onRetry: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [result, setResult] = useState("");
  const pageUrl = `${window.location.origin}${circlePath(event.id, circle.id)}`;
  const promotion = useMemo(
    () => records ? circlePromotion(event, circle, records.map((record) => record.placement), window.location.origin) : null,
    [circle, event, records],
  );
  const canShare = typeof navigator.share === "function";

  const selectText = () => {
    box.current?.focus();
    box.current?.select();
  };
  const copy = () => {
    if (!promotion) return;
    void writeClipboard(promotion.full)
      .then(() => setResult("已複製宣傳文字與連結。"))
      .catch(() => {
        selectText();
        setResult("無法自動複製，文字已選取，請自行複製。");
      });
  };
  const share = () => {
    if (!promotion) return;
    void navigator.share({ title: circle.name, text: promotion.text, url: promotion.url })
      .then(() => setResult(""))
      // Closing the share sheet is a choice, not a failure.
      .catch((error: unknown) => setResult(error instanceof DOMException && error.name === "AbortError" ? "" : "無法開啟分享，請改用複製。"));
  };

  return <section className={styles.sharePanel} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>分享公開頁</h3>
    {promotion
      ? <>
        <label htmlFor={`${id}-text`}>宣傳文字</label>
        <textarea id={`${id}-text`} ref={box} readOnly rows={5} value={promotion.full} onFocus={(event) => event.currentTarget.select()} />
      </>
      : failed
        ? <p className={styles.shareResult} role="alert">無法取得攤位資料，宣傳文字暫時無法產生。<button type="button" className={styles.inlineButton} onClick={onRetry}>重新取得</button></p>
        : <p className={styles.shareResult} role="status">正在準備宣傳文字…</p>}
    <div className={styles.shareActions}>
      <a className={styles.shareLink} href={pageUrl} target="_blank" rel="noreferrer">查看公開頁</a>
      <button type="button" disabled={!promotion} onClick={copy}>複製宣傳文字與連結</button>
      {canShare && <button type="button" className={styles.secondaryButton} disabled={!promotion} onClick={share}>分享</button>}
    </div>
    <p className={styles.shareResult} role="status">{result}</p>
  </section>;
}
