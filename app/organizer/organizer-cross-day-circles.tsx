import { useMemo, useState } from "react";
import { groupOrganizerCircles } from "../organizer-circle-groups.mjs";
import type { OrganizerNormalizedImportRow } from "../organizer-import";
import type { OrganizerEventDetail } from "../organizer-client";
import { organizerDayLabel, organizerVenueSpaceLabel } from "./organizer-shared";
import styles from "./organizer.module.css";

/** Uses the publication grouping over the entire list, before view filters. */
export function CrossDayCircles({ rows, detail }: {
  rows: readonly OrganizerNormalizedImportRow[]; detail: OrganizerEventDetail;
}) {
  const [page, setPage] = useState(0);
  const groups = useMemo(() => groupOrganizerCircles(rows).filter(group => group.days.length > 1), [rows]);
  if (!groups.length) return null;
  const pages = Math.ceil(groups.length / 25);
  const current = Math.min(page, pages - 1);
  return <details className={styles.areaNamePreview}>
    <summary>跨日整合：{groups.length} 個社團</summary>
    <p>同一社團的各日攤位會整合在一個出展頁。請核對名稱與各日攤位；不同社團若同名，請填不同的主辦內部編號。</p>
    <div className={`${styles.importPreview} ${styles.previewTable}`}><table><thead><tr><th>社團</th><th>各日攤位</th></tr></thead>
      <tbody>{groups.slice(current * 25, (current + 1) * 25).map(group => <tr key={group.key}>
        <td>{group.name}</td><td>{group.rowIndexes.map(index => {
          const row = rows[index];
          return <div key={index}>{organizerDayLabel(detail.draft.event.days, row.dayId)} · {organizerVenueSpaceLabel(detail.venueCatalog, row.venueSpaceId)} · {row.codes.join("、")}</div>;
        })}</td>
      </tr>)}</tbody>
    </table></div>
    {pages > 1 && <div className={styles.rosterTools}><span>第 {current + 1} / {pages} 頁</span>
      <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>上一組社團</button>
      <button type="button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>下一組社團</button>
    </div>}
  </details>;
}
