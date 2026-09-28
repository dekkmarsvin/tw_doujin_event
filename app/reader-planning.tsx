import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePlanning } from "./use-planning";
import type { FavoriteRecord } from "./planning-store";

type Undo = { favorite: FavoriteRecord; circleName: string } | null;
function useReaderPlanningState(eventId: string, settled: boolean) {
  const planning = usePlanning(eventId, settled);
  const [favoriteUndo, setFavoriteUndo] = useState<Undo>(null);
  useEffect(() => {
    if (!favoriteUndo) return;
    const timeout = window.setTimeout(() => setFavoriteUndo(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [favoriteUndo]);
  return { ...planning, favoriteUndo, setFavoriteUndo };
}
const Context = createContext<ReturnType<typeof useReaderPlanningState> | null>(null);
export function ReaderPlanningProvider({ eventId, settled, children }: { eventId: string; settled: boolean; children: ReactNode }) {
  const value = useReaderPlanningState(eventId, settled);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
/** Standalone map/organizer previews retain their own planning owner. */
export function ReaderPlanningBoundary({ eventId, settled, children }: { eventId: string; settled: boolean; children: ReactNode }) {
  const existing = useContext(Context);
  return existing ? children : <ReaderPlanningProvider eventId={eventId} settled={settled}>{children}</ReaderPlanningProvider>;
}
export function useReaderPlanning() {
  const planning = useContext(Context);
  if (!planning) throw new Error("Reader planning owner is missing.");
  return planning;
}
