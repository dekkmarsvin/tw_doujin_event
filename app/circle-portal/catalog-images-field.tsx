"use client";

import { usePortalText, portalNotice, noticeError, type PortalNotice } from "./portal-i18n";
import { useLocale } from "../i18n/locale-context";

import { useId, useRef, useState } from "react";
import { catalogFileProblem, prepareCatalogImage } from "../catalog-image-prepare";
import { uploadCatalogImage } from "../circle-editor-client";
import { OVERRIDE_LIMITS, type CircleCatalogImage } from "../circle-overrides";
import { pointTo } from "./point-to";
import styles from "./portal.module.css";

type Notice = { kind: "idle" | "busy" | "ok" | "error"; message: PortalNotice };
const IDLE: Notice = { kind: "idle", message: "" };

/**
 * The sale sheet for this event: up to three pages, in the order readers see
 * them. Each chosen file is resized and re-encoded here before it leaves the
 * browser, then staged; like every other field it is published only by the
 * editor's confirmed save.
 *
 * Uploading asks the author to confirm the pages suit readers of every age
 * (#413). The confirmation gates choosing a file, so it is given before the
 * picture exists rather than read past on the way to saving. While it is
 * unticked it is outlined as the thing in the way, and pressing 新增 or 替換
 * brings the author to it instead of doing nothing.
 */
export function CatalogImagesField({ circleId, images, busy, onUpdate, onUploading }: {
  circleId: string;
  images: CircleCatalogImage[];
  busy: boolean;
  /** An updater, so a finished upload lands on whatever order the list has by then. */
  onUpdate: (update: (current: CircleCatalogImage[]) => CircleCatalogImage[]) => void;
  onUploading: (active: boolean) => void;
}) {
  const t = usePortalText();
  const { locale } = useLocale();
  const id = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<Notice>(IDLE);
  // Pages whose short edge ended up below what small print needs, by address.
  const [small, setSmall] = useState<ReadonlySet<string>>(new Set());
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const confirmBox = useRef<HTMLInputElement>(null);
  // Set by a press on something the confirmation holds back; the ring it
  // adds goes with the tick.
  const [called, setCalled] = useState(false);
  const full = images.length >= OVERRIDE_LIMITS.catalogImages;
  const askToConfirm = () => {
    setCalled(true);
    pointTo(confirmBox.current);
  };

  const upload = (file: File, replacing: string | null) => {
    const problem = catalogFileProblem(file);
    if (problem) {
      setNotice({ kind: "error", message: problem });
      return;
    }
    setNotice({ kind: "busy", message: "處理並上傳品書中…" });
    onUploading(true);
    void prepareCatalogImage(file)
      .then(async (prepared) => {
        const { image } = await uploadCatalogImage(circleId, prepared.full, prepared.preview, images.flatMap((page) => [page.url, page.previewUrl]));
        onUpdate((current) => replacing && current.some((page) => page.url === replacing)
          ? current.map((page) => page.url === replacing ? image : page)
          : [...current, image].slice(0, OVERRIDE_LIMITS.catalogImages));
        if (!prepared.readable) setSmall((current) => new Set([...current, image.url]));
        setNotice({ kind: "ok", message: "品書已上傳，儲存後公開。" });
      })
      .catch((error: unknown) => setNotice({ kind: "error", message: noticeError(error) }))
      .finally(() => onUploading(false));
  };
  const move = (index: number, direction: -1 | 1) => onUpdate((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  return <div className={styles.catalogField}>
    <p className={styles.editorHint}>{t("最多 {max} 張，依順序顯示。JPG、PNG、WebP；PDF 或 PSD 請先匯出成圖片。", { max: OVERRIDE_LIMITS.catalogImages })}</p>
    <label className={`${styles.confirmCheck} ${confirmed ? "" : styles.gate} ${!confirmed && called ? styles.calledOut : ""}`}>
      <input ref={confirmBox} type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setCalled(false); }} />
      <span>{t("我確認這些圖片適合所有年齡的讀者觀看。")}</span>
    </label>
    {/* One tile per page in reading order, and the next free place as the
        last tile: the list never has more tiles than the limit has pages, so
        the row is filled rather than a strip of small pictures down the left. */}
    <ol className={styles.catalogList}>
      {images.map((image, index) => <li key={image.url} className={styles.catalogPage}>
        <img src={image.previewUrl} alt={t("第 {index} 張品書預覽", { index: index + 1 })} />
        <div className={styles.catalogPageHead}>
          <b>{t("第 {index} 張", { index: index + 1 })}</b>
          <span>
            <button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={t("把第 {index} 張品書往前移", { index: index + 1 })}>←</button>
            <button type="button" disabled={busy || index === images.length - 1} onClick={() => move(index, 1)} aria-label={t("把第 {index} 張品書往後移", { index: index + 1 })}>→</button>
          </span>
        </div>
        {small.has(image.url) && <p className={styles.notice}>{t("縮小後文字可能太小，建議分成多張上傳。")}</p>}
        <div className={styles.catalogPageActions}>
          <button type="button" disabled={busy} aria-disabled={!confirmed || undefined} onClick={() => {
            if (!confirmed) return askToConfirm();
            replaceTarget.current = image.url;
            replaceInput.current?.click();
          }} aria-label={t("替換第 {index} 張品書", { index: index + 1 })}>{t("替換")}</button>
          <button type="button" disabled={busy} onClick={() => onUpdate((current) => current.filter((page) => page.url !== image.url))} aria-label={t("移除第 {index} 張品書", { index: index + 1 })}>{t("移除")}</button>
        </div>
      </li>)}
      {!full && <li className={styles.catalogAdd}>
        {/* The whole tile is the label, so a press anywhere on it reaches the
            input; the name is its own span so the reason beside it describes
            the control rather than renaming it. */}
        <label htmlFor={`${id}-add`}>
          <span id={`${id}-add-name`}>{t("新增品書圖片")}</span>
          {!confirmed && <small id={`${id}-add-gate`}>{t("先勾選上方的確認")}</small>}
        </label>
        <input
          id={`${id}-add`} type="file" accept="image/jpeg,image/png,image/webp" className={styles.visuallyHidden}
          aria-labelledby={`${id}-add-name`} aria-describedby={confirmed ? undefined : `${id}-add-gate`}
          disabled={busy} aria-disabled={!confirmed || undefined}
          // Cancelling the click is what keeps the file dialog shut.
          onClick={(event) => { if (!confirmed) { event.preventDefault(); askToConfirm(); } }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (file && confirmed) upload(file, null);
          }}
        />
      </li>}
    </ol>
    <input
      ref={replaceInput} type="file" accept="image/jpeg,image/png,image/webp" hidden tabIndex={-1} aria-hidden="true"
      onChange={(event) => {
        const file = event.target.files?.[0];
        const replacing = replaceTarget.current;
        event.currentTarget.value = "";
        if (file && replacing) upload(file, replacing);
      }}
    />
    {full && <p className={styles.editorHint}>{t("已達 {max} 張上限，可替換或移除後再新增。", { max: OVERRIDE_LIMITS.catalogImages })}</p>}
    {notice.kind !== "idle" && <p className={notice.kind === "error" ? styles.error : styles.notice} role="status">{portalNotice(notice.message, locale)}</p>}
  </div>;
}
