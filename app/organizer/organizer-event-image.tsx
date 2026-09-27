/** 活動圖片欄位 (#396)：建立活動與已發布修正共用。
 *
 * Uploading only stages the picture; it becomes part of the event when the
 * surrounding form is saved, and public when the event is approved.
 */
import { useState } from "react";
import { EVENT_IMAGE_MIN_WIDTH, type EventImage, type PublishedEventImage } from "../event-image";
import { organizerEventImagePreviewPath, uploadOrganizerEventImage } from "../organizer-client";
import { message } from "./organizer-shared";
import styles from "./organizer.module.css";

/** `image` undefined means "no change" where a published picture exists
 * (`published`), and simply "none" in a first draft. null removes.
 * The surrounding form owns saved/unsaved feedback for all its fields. */
export function EventImageField({ candidateId, image, published, editable, onChange }: {
  candidateId: string;
  image: EventImage | null | undefined;
  published?: PublishedEventImage;
  editable: boolean;
  onChange: (image: EventImage | null | undefined) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A file input cannot be cleared by state; a new key gives an empty one.
  const [inputKey, setInputKey] = useState(0);
  const upload = async () => {
    if (!file || pending) return;
    setPending(true); setError(null);
    try {
      const result = await uploadOrganizerEventImage(candidateId, file);
      setFile(null); setInputKey((key) => key + 1);
      onChange(result.image);
    } catch (error) { setError(message(error)); }
    finally { setPending(false); }
  };
  return <div className={`${styles.full} ${styles.eventImageField}`}>
    <h4>活動圖片（選填）</h4>
    <p>搜尋結果與分享連結會顯示這張圖。JPEG、PNG 或 WebP，寬至少 {EVENT_IMAGE_MIN_WIDTH} px，5 MiB 以內。</p>
    {image ? <EventImagePreview key={`${image.url}:${inputKey}`} candidateId={candidateId} image={image} alt="活動圖片" />
      : image === undefined && published ? <figure className={styles.eventImagePreview}>
      <img alt="已發布的活動圖片" src={published.url} />
      <figcaption>已發布・{published.width} × {published.height} px</figcaption>
    </figure> : image === null && published ? <p>已發布的圖片將移除。</p> : null}
    {editable && <fieldset disabled={pending}>
      <label>{image || (image === undefined && published) ? "更換圖片" : "選擇圖片"}<input key={inputKey} type="file" accept="image/jpeg,image/png,image/webp"
        onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(null); }} /></label>
      <div className={styles.row}>
        <button type="button" disabled={!file} onClick={() => void upload()}>{pending ? "上傳中…" : "上傳"}</button>
        {(image || (image === undefined && published)) && <button type="button" className={styles.dangerText}
          onClick={() => { onChange(null); setError(null); }}>移除圖片</button>}
        {published && image !== undefined && <button type="button" className={styles.ghost}
          onClick={() => { onChange(undefined); setError(null); }}>改回已發布的圖片</button>}
      </div>
    </fieldset>}
    {error && <p role="alert" className={styles.issueError}>{error}</p>}
  </div>;
}

/** Saved replacements are private until approval; the previous picture is
 * already public. A picture inherited by a candidate may only exist publicly. */
export function EventImagePreview({ candidateId, image, alt }: {
  candidateId?: string; image: PublishedEventImage | EventImage; alt: string;
}) {
  const [fallback, setFallback] = useState(false);
  const [missing, setMissing] = useState(false);
  const src = candidateId && "sha256" in image && !fallback
    ? organizerEventImagePreviewPath(candidateId, image) : image.url;
  return missing ? <p className={styles.issueError}>無法載入{alt}。</p> : <figure className={styles.eventImagePreview}>
    <img alt={alt} src={src} onError={() => src === image.url ? setMissing(true) : setFallback(true)} />
    <figcaption>{image.width} × {image.height} px</figcaption>
  </figure>;
}
