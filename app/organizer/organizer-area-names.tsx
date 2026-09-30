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
      {space.areaIds.map(id => <label key={id}><span>{assignment.areaLabels?.[id] || id}</span>
        <input aria-label={`${organizerVenueSpaceLabel(detail.venueCatalog, space.venueSpaceId)} ${assignment.areaLabels?.[id] || id} 展區名稱`}
          required maxLength={60} placeholder="展區名稱" value={labels[space.venueSpaceId]?.[id] ?? assignment.areaLabels?.[id] ?? id}
          onChange={event => onChange(space.venueSpaceId, id, event.target.value)} />
      </label>)}
    </fieldset>;
  })}</div>;
}
