export const APPLICATION_RELATIONSHIPS = {
  organizer: "主辦人員",
  authorized: "獲授權人員",
  curator: "資料整理者",
} as const;

export type OrganizerApplicationInput = {
  name: string;
  officialUrl: string;
  startDate: string;
  endDate: string;
  location: string;
  relationship: keyof typeof APPLICATION_RELATIONSHIPS;
  note: string;
};

export type OrganizerApplication = OrganizerApplicationInput & {
  id: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  reviewedAt: number | null;
  reason: string;
  candidateId: string | null;
  applicantEmail?: string | null;
};

function date(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function parseOrganizerApplication(value: unknown): OrganizerApplicationInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const keys = ["name", "officialUrl", "startDate", "endDate", "location", "relationship", "note"];
  if (Object.keys(raw).some((key) => !keys.includes(key)) || keys.some((key) => typeof raw[key] !== "string")) return null;
  const input = Object.fromEntries(keys.map((key) => [key, (raw[key] as string).trim()])) as OrganizerApplicationInput;
  if (!input.name || input.name.length > 120 || input.officialUrl.length > 2048 || input.location.length > 200
    || input.note.length > 1000 || !Object.hasOwn(APPLICATION_RELATIONSHIPS, input.relationship)
    || (input.relationship === "curator" && !input.note)
    || !date(input.startDate) || !date(input.endDate) || input.endDate < input.startDate) return null;
  try {
    const url = new URL(input.officialUrl);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    input.officialUrl = url.href;
  } catch { return null; }
  return input;
}
