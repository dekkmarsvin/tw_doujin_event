import type { PortalSession } from "./circle-editor-client";

export function workspaceSections(session: PortalSession | null) {
  return [
    { id: "circle", title: "社團資料", visible: true },
    { id: "organizer", title: "主辦工作區", visible: session?.hasOrganizerAccess || session?.isAdmin || session?.canApplyForEvent || session?.hasEventApplications },
    { id: "admin", title: "網站管理", visible: session?.isAdmin },
  ] as const;
}
