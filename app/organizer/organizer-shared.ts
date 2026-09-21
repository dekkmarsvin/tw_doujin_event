/** Types, labels and helpers shared by the organizer workspace panels.
 *
 * These left `organizer-app.tsx` with the panels that use them (#224). They
 * are the pieces more than one panel needs, so they belong beside the panels
 * rather than inside whichever file happened to hold them first.
 */
import { useEffect, useState } from "react";
import { PortalError } from "../circle-editor-client";
import { type OrganizerEventDetail, type OrganizerEventSummary } from "../organizer-client";
import { validateOrganizerVenueCatalogAssignments, type OrganizerVenueCatalog } from "../organizer-venue-catalog";
import { type OrganizerEventDraft, type OrganizerValidationIssue } from "../organizer-event";
import { organizerGuidedTaskIssues, type OrganizerGuidedTask, type OrganizerWorkspaceSection } from "../organizer-workspace";
import { getMapTemplateMetadata, hasMapTemplateRecognizer, listMapTemplateOptions } from "../map-template-registry";

export type Notice = { kind: "idle" | "busy" | "ok" | "error"; message: string };
export type PendingNavigation = { description: string; run: () => void };
export const IDLE: Notice = { kind: "idle", message: "" };
export const SECTION_LABEL: Record<OrganizerWorkspaceSection, string> = {
  event: "活動",
  venue: "場館與使用空間",
  import: "攤位匯入",
  map: "地圖",
  validate: "檢查與預覽",
  review: "送審與發布",
};
export const organizerSectionLabel = (detail: OrganizerEventDetail, section: OrganizerWorkspaceSection) =>
  detail.event.operation === "AMEND" && section === "import" ? "名單修正" : SECTION_LABEL[section];
export const GUIDED_LABEL: Record<OrganizerGuidedTask, string> = {
  identity_source: "活動名稱與來源",
  days: "活動日期",
  venue: "場館與使用空間",
};
/** What each basic setting is actually asking. The heading names the task;
 * this says what answering it means, so the organizer does not have to infer
 * the question from the field names (#221 2.1-2.3). */
export const TASK_QUESTION: Record<OrganizerGuidedTask, string> = {
  identity_source: "填寫活動名稱，以及主辦單位公告這場活動的頁面。",
  days: "這場活動辦在哪幾天？每一天各填一個日期。",
  venue: "選擇活動使用的場館與空間。例如同一場館使用兩層樓，可分別加入 1F 與 2F。",
};
export const READINESS_LABEL = {
  complete: "已完成",
  available: "可開始",
  needs_attention: "需要處理",
  blocked: "需先完成前面步驟",
} as const;
export const STATUS_LABEL: Record<OrganizerEventSummary["status"], string> = {
  draft: "草稿",
  changes_requested: "要求修改",
  submitted: "審閱中",
  approved: "已核准，等待發布",
  publishing: "發布中",
  published: "已發布",
  failed: "發布失敗",
};

export const ROLE_LABEL: Record<string, string> = { owner: "負責人", editor: "協作者", admin: "網站管理者", system: "系統" };
export const STEP_LABEL: Record<OrganizerValidationIssue["step"], string> = {
  event: "活動",
  venue: "場館與使用空間",
  import: "攤位匯入",
  map: "地圖",
  preview: "預覽",
};
export const PUBLICATION_STATUS_LABEL: Record<string, string> = {
  queued: "等待發布",
  publishing: "發布中",
  published: "已發布",
  failed: "發布失敗",
};

/** What picking this template actually does, in the two terms the organizer
 * feels: whether an uploaded floor plan can be recognized, and what the saved
 * map is checked against. */
export function mapTemplatePreview(template: string) {
  const option = listMapTemplateOptions().find((item) => item.id === template);
  const metadata = getMapTemplateMetadata(template);
  const shape = metadata.expectedRows === null || metadata.expectedSlots === null
    ? `${metadata.rowLabel}與${metadata.slotLabel}數量依你畫的版面。`
    : `${metadata.rowLabel}，共 ${metadata.expectedRows} 排、${metadata.expectedSlots} 個${metadata.slotLabel}。`;
  return {
    summary: option?.summary ?? "沿用通用檢查；上傳配置圖後手動編輯攤位。",
    recognizer: hasMapTemplateRecognizer(template) ? "可自動辨識配置圖" : "需手動編輯配置圖",
    shape,
  };
}

export function message(error: unknown) {
  return error instanceof PortalError || error instanceof Error ? error.message : "操作失敗，請稍後再試。";
}

export function organizerVenueSpaceLabel(catalog: OrganizerVenueCatalog, venueSpaceId: string) {
  for (const venue of catalog.venues) {
    const space = venue.spaces.find((item) => item.id === venueSpaceId);
    if (space) return `${venue.name}・${space.name}`;
  }
  return "原使用空間已不存在";
}

/** Maps are addressed by the day's stable id, which is what the workspace
 * stores and what a map summary comes back with. It is not what the day is
 * called, so nothing showing a map to a person may print it. */
export function organizerDayLabel(days: readonly { id: string; label: string }[], periodKey: string) {
  return days.find((day) => day.id === periodKey)?.label ?? "原活動日已不存在";
}

/** How the organizer workspace says a validation problem.
 *
 * The map validator serves two control surfaces and knows neither: it has
 * booth codes and nothing else -- no day label, no space name, no import file
 * -- so the sentence it can write is necessarily the poorer one. The wording
 * for this surface is built here, where that context exists, and both the
 * 待修正清單 sidebar and the 檢查與預覽 card read it from one place rather than
 * showing two descriptions of the same problem side by side (#223). */
export function organizerIssueMessage(
  issue: { code: string; message: string; target?: string; step?: string; section?: string; boothCodes?: readonly string[]; count?: number },
  catalog: OrganizerVenueCatalog,
  draft: OrganizerEventDraft,
) {
  /* missing_booth is raised by the import step as well, where it means a
   * source row carries no booth code -- a different problem with a different
   * repair. The map wording is therefore keyed on the step as well as the
   * code, never on the code alone. The two shapes the workspace holds a
   * problem in name that step differently: a validation issue carries `step`,
   * a readiness blocker carries `section`. */
  const onMap = (issue.step ?? issue.section) === "map";
  const booths = issue.count ?? issue.boothCodes?.length;
  if (onMap && issue.code === "unknown_booth") {
    return `地圖有 ${booths ?? "部分"} 個攤位代碼未出現在同一天、同一場館空間的匯入資料。`;
  }
  if (onMap && issue.code === "missing_booth") {
    return `匯入資料有 ${booths ?? "部分"} 個攤位代碼未出現在這份地圖。`;
  }
  if (issue.code === "missing_space_import" && issue.target) {
    return `匯入資料沒有包含 ${organizerVenueSpaceLabel(catalog, issue.target)} 的攤位。`;
  }
  if (issue.code === "missing_map" && issue.target) {
    const [dayId, venueSpaceId] = issue.target.split("/");
    const day = draft.event.days.find((item) => item.id === dayId);
    return `缺少 ${day?.label ?? "活動日"}・${organizerVenueSpaceLabel(catalog, venueSpaceId)} 的地圖。`;
  }
  if (issue.target && issue.code.startsWith("stale_import_")) {
    return `${organizerVenueSpaceLabel(catalog, issue.target)}：${issue.message}`;
  }
  return issue.message;
}

export function organizerGuidedDraftIssues(draft: OrganizerEventDraft, task: OrganizerGuidedTask, catalog: OrganizerVenueCatalog) {
  const issues = organizerGuidedTaskIssues(draft, task);
  return task === "venue"
    ? [...issues, ...validateOrganizerVenueCatalogAssignments(draft.venue.assignments, catalog)]
    : issues;
}

export function takeLoginToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("login");
  if (!token) return null;
  url.searchParams.delete("login");
  window.history.replaceState(null, "", url);
  return token;
}

export function useDesktopViewport() {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 1040px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1040px)");
    const update = () => setIsDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return isDesktop;
}
