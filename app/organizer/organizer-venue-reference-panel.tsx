import { useState } from "react";
import { createOrganizerReferenceEntry, type OrganizerEventDetail } from "../organizer-client";
import styles from "./organizer.module.css";

export function OrganizerVenueReferencePanel({ entry, candidateId, expectedVersion, disabled, onCreated }: {
  entry: NonNullable<OrganizerEventDetail["missingVenueReferences"]>[number];
  candidateId: string;
  expectedVersion: number;
  disabled: boolean;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState(entry.sourceUrl ?? "");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = entry.kind === "venue" ? "場館" : "場地";
  return <form className={styles.catalogCreator} aria-label={`補齊${entry.name}來源`} onSubmit={(event) => {
    event.preventDefault();
    if (disabled || busy) return;
    setBusy(true); setError("");
    void createOrganizerReferenceEntry(candidateId, { expectedVersion, kind: entry.kind, referenceId: entry.id, name, sourceUrl,
      ...(entry.kind === "venue" ? { address } : {}) })
      .then(onCreated)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "無法補齊來源，請重新載入。"))
      .finally(() => setBusy(false));
  }}>
    <h4>{entry.name}：補齊官方來源</h4>
    <p>這筆舊資料尚未保存完整來源。請核對官方資料，填入要公開的名稱與來源網址；保存後可供活動共用。</p>
    <fieldset disabled={disabled || busy}>
      <label>{label}公開名稱<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>{label}公開來源網址<input required type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label>
      {entry.kind === "venue" && <label>場館地址<input required maxLength={200} value={address} onChange={(event) => setAddress(event.target.value)} /><small>貼上場館官方網站上的完整地址。</small></label>}
      <button type="submit">保存{label}官方來源</button>
    </fieldset>
    {disabled && <p>請先儲存場館設定；只有編輯中的活動可以補齊來源。</p>}
    {error && <p role="alert" className={styles.issueError}>{error}</p>}
  </form>;
}

/** A venue whose public record was saved before venues had addresses (#395). */
export function OrganizerVenueAddressPanel({ entry, candidateId, expectedVersion, disabled, onCreated }: {
  entry: NonNullable<OrganizerEventDetail["missingVenueAddresses"]>[number];
  candidateId: string;
  expectedVersion: number;
  disabled: boolean;
  onCreated: () => Promise<void>;
}) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className={styles.catalogCreator} aria-label={`補上${entry.name}地址`} onSubmit={(event) => {
    event.preventDefault();
    if (disabled || busy) return;
    if (!address.trim()) { setError("請填寫場館地址。"); return; }
    setBusy(true); setError("");
    void createOrganizerReferenceEntry(candidateId, { expectedVersion, kind: "venue-address", referenceId: entry.id, address })
      .then(onCreated)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "無法保存地址，請重新載入。"))
      .finally(() => setBusy(false));
  }}>
    <h4>{entry.name}：補上地址</h4>
    <p>場館需要地址才能送審。</p>
    <fieldset disabled={disabled || busy}>
      <label>場館地址<input maxLength={200} aria-invalid={error ? true : undefined} value={address} onChange={(event) => setAddress(event.target.value)} /><small>貼上場館官方網站上的完整地址。</small></label>
      <button type="submit">保存地址</button>
    </fieldset>
    {disabled && <p>請先儲存場館設定；只有編輯中的活動可以補上地址。</p>}
    {error && <p role="alert" className={styles.issueError}>{error}</p>}
  </form>;
}
