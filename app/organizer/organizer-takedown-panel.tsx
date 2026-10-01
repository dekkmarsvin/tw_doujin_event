import { useMemo } from "react";
import { AdminTakedownPanel, type TakedownScope } from "../admin/admin-panels";
import { searchOrganizerTakedownCircles, takedownOrganizerOverride } from "../organizer-client";

export function OrganizerTakedownPanel({ candidateId, eventId }: { candidateId: string; eventId: string }) {
  const scope = useMemo<TakedownScope>(() => ({
    search: query => searchOrganizerTakedownCircles(candidateId, query),
    takedown: (circleId, reason) => takedownOrganizerOverride(candidateId, circleId, reason),
  }), [candidateId]);
  return <AdminTakedownPanel initialEventId={eventId} scope={scope} />;
}
