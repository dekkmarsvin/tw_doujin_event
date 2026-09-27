"use client";

import { useId, useRef, useState } from "react";
import { catalogFileProblem, prepareCatalogImage } from "../catalog-image-prepare";
import { uploadCatalogImage } from "../circle-editor-client";
import { OVERRIDE_LIMITS, type CircleCatalogImage } from "../circle-overrides";
import styles from "./portal.module.css";

type Notice = { kind: "idle" | "busy" | "ok" | "error"; message: string };
const IDLE: Notice = { kind: "idle", message: "" };

/**
 * The sale sheet for this event: up to three pages, in the order readers see
 * them. Each chosen file is resized and re-encoded here before it leaves the
 * browser, then staged; like every other field it is published only by the
 * editor's confirmed save.
 *
 * Uploading asks the author to confirm the pages suit readers of every age
 * (#413). The confirmation gates choosing a file, so it is given before the
 * picture exists rather than read past on the way to saving.
 */
export function CatalogImagesField({ circleId, images, busy, onUpdate, onUploading }: {
  circleId: string;
  images: CircleCatalogImage[];
  busy: boolean;
  /** An updater, so a finished upload lands on whatever order the list has by then. */
  onUpdate: (update: (current: CircleCatalogImage[]) => CircleCatalogImage[]) => void;
  onUploading: (active: boolean) => void;
}) {
  const id = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<Notice>(IDLE);
  // Pages whose short edge ended up below what small print needs, by address.
  const [small, setSmall] = useState<ReadonlySet<string>>(new Set());
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const full = images.length >= OVERRIDE_LIMITS.catalogImages;

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
      .catch((error: unknown) => setNotice({ kind: "error", message: error instanceof Error ? error.message : "品書上傳失敗，請再試一次。" }))
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
    <p className={styles.editorHint}>最多 {OVERRIDE_LIMITS.catalogImages} 張，依順序顯示。JPG、PNG、WebP；PDF 或 PSD 請先匯出成圖片。</p>
    {images.length > 0 && <ol className={styles.catalogList}>
      {images.map((image, index) => <li key={image.url}>
        <img src={image.previewUrl} alt={`第 ${index + 1} 張品書預覽`} />
        <div className={styles.catalogItem}>
          <b>第 {index + 1} 張</b>
          {small.has(image.url) && <p className={styles.notice}>縮小後文字可能太小，建議分成多張上傳。</p>}
          <div className={styles.linkActions}>
            <button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`把第 ${index + 1} 張品書往前移`}>↑</button>
            <button type="button" disabled={busy || index === images.length - 1} onClick={() => move(index, 1)} aria-label={`把第 ${index + 1} 張品書往後移`}>↓</button>
            <button type="button" disabled={busy || !confirmed} onClick={() => {
              replaceTarget.current = image.url;
              replaceInput.current?.click();
            }} aria-label={`替換第 ${index + 1} 張品書`}>替換</button>
            <button type="button" disabled={busy} onClick={() => onUpdate((current) => current.filter((page) => page.url !== image.url))} aria-label={`移除第 ${index + 1} 張品書`}>移除</button>
          </div>
        </div>
      </li>)}
    </ol>}
    <input
      ref={replaceInput} type="file" accept="image/jpeg,image/png,image/webp" hidden tabIndex={-1} aria-hidden="true"
      onChange={(event) => {
        const file = event.target.files?.[0];
        const replacing = replaceTarget.current;
        event.currentTarget.value = "";
        if (file && replacing) upload(file, replacing);
      }}
    />

    <label className={styles.confirmCheck}>
      <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
      <span>我確認這些圖片適合所有年齡的讀者觀看。</span>
    </label>
    <label htmlFor={`${id}-add`}>新增品書圖片</label>
    <input
      id={`${id}-add`} type="file" accept="image/jpeg,image/png,image/webp"
      disabled={busy || !confirmed || full}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.currentTarget.value = "";
        if (file) upload(file, null);
      }}
    />
    {full && <p className={styles.editorHint}>已達 {OVERRIDE_LIMITS.catalogImages} 張上限，可替換或移除後再新增。</p>}
    {notice.kind !== "idle" && <p className={notice.kind === "error" ? styles.error : styles.notice} role="status">{notice.message}</p>}
  </div>;
}
