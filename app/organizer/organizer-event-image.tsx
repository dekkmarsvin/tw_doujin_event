/** 活動圖片欄位 (#396)：建立活動與已發布修正共用。
 *
 * Uploading only stages the picture; it becomes part of the event when the
 * surrounding form is saved, and public when the event is approved.
 */
import { useState } from "react";
import { EVENT_IMAGE_MIN_WIDTH, sameEventImage, type EventImage, type PublishedEventImage } from "../event-image";
import { organizerEventImagePreviewPath, uploadOrganizerEventImage } from "../organizer-client";
import { message } from "./organizer-shared";
import styles from "./organizer.module.css";

/** `image` undefined means "no change" where a published picture exists
 * (`published`), and simply "none" in a first draft. null removes. `saved`
 * is what the surrounding form last saved, so "not saved yet" stops being
 * said once it is no longer true. */
export function EventImageField({ candidateId, image, saved, published, editable, onChange }: {
  candidateId: string;
  image: EventImage | null | undefined;
  saved: EventImage | null | undefined;
  published?: PublishedEventImage;
  editable: boolean;
  onChange: (image: EventImage | null | undefined) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // A picture already published has no private copy under this candidate; the
  // preview then falls back to where it is public.
  const [fallback, setFallback] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  // A file input cannot be cleared by state; a new key gives an empty one.
  const [inputKey, setInputKey] = useState(0);
  // null (remove) and undefined (keep, or none) are different answers here.
  const unsaved = image === null || saved === null ? image !== saved : !sameEventImage(image, saved);
  const upload = async () => {
    if (!file || !rights || pending) return;
    setPending(true); setStatus(null);
    try {
      const result = await uploadOrganizerEventImage(candidateId, file);
      setFallback(null); setMissing(null); setFile(null); setRights(false); setInputKey((key) => key + 1);
      onChange(result.image);
      setStatus({ ok: true, text: "已上傳，尚未儲存。" });
    } catch (error) { setStatus({ ok: false, text: message(error) }); }
    finally { setPending(false); }
  };
  return <div className={`${styles.full} ${styles.eventImageField}`}>
    <h4>活動圖片（選填）</h4>
    <p>搜尋結果與分享連結會顯示這張圖。JPEG、PNG 或 WebP，寬至少 {EVENT_IMAGE_MIN_WIDTH} px，5 MiB 以內。</p>
    {image && missing === image.sha256 ? <p className={styles.issueError}>找不到這張圖片，請重新上傳。</p>
      : image ? <figure className={styles.eventImagePreview}>
      <img alt="活動圖片" src={fallback === image.sha256 ? image.url : organizerEventImagePreviewPath(candidateId, image)}
        onError={() => fallback === image.sha256 ? setMissing(image.sha256) : setFallback(image.sha256)} />
      <figcaption>{image.width} × {image.height} px</figcaption>
    </figure> : image === undefined && published ? <figure className={styles.eventImagePreview}>
      <img alt="已發布的活動圖片" src={published.url} />
      <figcaption>已發布・{published.width} × {published.height} px</figcaption>
    </figure> : image === null && published ? <p>已發布的圖片將移除。</p> : null}
    {editable && <fieldset disabled={pending}>
      <label>{image || (image === undefined && published) ? "更換圖片" : "選擇圖片"}<input key={inputKey} type="file" accept="image/jpeg,image/png,image/webp"
        onChange={(event) => { setFile(event.target.files?.[0] ?? null); setStatus(null); }} /></label>
      <label className={styles.checkLabel}><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />我有權公開這張圖片</label>
      <div className={styles.row}>
        <button type="button" disabled={!file || !rights} onClick={() => void upload()}>{pending ? "上傳中…" : "上傳"}</button>
        {(image || (image === undefined && published)) && <button type="button" className={styles.dangerText}
          onClick={() => { onChange(null); setStatus({ ok: true, text: "已移除，尚未儲存。" }); }}>移除圖片</button>}
        {published && image !== undefined && <button type="button" className={styles.ghost}
          onClick={() => { onChange(undefined); setStatus(null); }}>改回已發布的圖片</button>}
      </div>
    </fieldset>}
    {status && (!status.ok || unsaved)
      && <p role={status.ok ? "status" : "alert"} className={status.ok ? undefined : styles.issueError}>{status.text}</p>}
  </div>;
}
