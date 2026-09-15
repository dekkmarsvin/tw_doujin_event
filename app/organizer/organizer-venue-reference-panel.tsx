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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = entry.kind === "venue" ? "場館" : "使用空間";
  return <form className={styles.catalogCreator} aria-label={`補齊${entry.name}來源`} onSubmit={(event) => {
    event.preventDefault();
    if (disabled || busy) return;
    setBusy(true); setError("");
    void createOrganizerReferenceEntry(candidateId, { expectedVersion, kind: entry.kind, referenceId: entry.id, name, sourceUrl })
      .then(onCreated)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "無法補齊來源，請重新載入。"))
      .finally(() => setBusy(false));
  }}>
    <h4>{entry.name}：補齊官方來源</h4>
    <p>這筆舊資料尚未保存完整來源。請核對官方資料，填入要公開的名稱與來源網址；保存後可供活動共用。</p>
    <fieldset disabled={disabled || busy}>
      <label>{label}公開名稱<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>{label}公開來源網址<input required type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label>
      <button type="submit">保存{label}官方來源</button>
    </fieldset>
    {disabled && <p>請先儲存場館設定；只有編輯中的活動可以補齊來源。</p>}
    {error && <p role="alert" className={styles.issueError}>{error}</p>}
  </form>;
}
