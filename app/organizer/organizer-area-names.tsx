import type { OrganizerEventDetail } from "../organizer-client";
import { organizerVenueSpaceLabel } from "./organizer-shared";
import styles from "./organizer.module.css";

export type AreaNames = Record<string, Record<string, string>>;
export function AreaNameFields({ detail, spaces, labels, onChange, disabled = false }: {
  detail: OrganizerEventDetail;
  spaces: readonly { venueSpaceId: string; areaIds: readonly string[] }[];
  labels: AreaNames;
  onChange: (spaceId: string, areaId: string, label: string) => void;
  disabled?: boolean;
}) {
  return <div className={styles.areaNames}>{spaces.map(space => {
    const assignment = detail.draft.venue.assignments.find(item => item.venueSpaceId === space.venueSpaceId);
    if (!assignment || assignment.areaMode === "none" || !space.areaIds.length) return null;
    return <fieldset key={space.venueSpaceId} disabled={disabled}>
      <legend>{organizerVenueSpaceLabel(detail.venueCatalog, space.venueSpaceId)}</legend>
      {space.areaIds.map(id => <label key={id}><span>{id}</span>
        <input aria-label={`${organizerVenueSpaceLabel(detail.venueCatalog, space.venueSpaceId)} ${id} 顯示名稱（選填）`}
          maxLength={60} placeholder={id} value={labels[space.venueSpaceId]?.[id] ?? assignment.areaLabels?.[id] ?? ""}
          onChange={event => onChange(space.venueSpaceId, id, event.target.value)} />
      </label>)}
    </fieldset>;
  })}</div>;
}
