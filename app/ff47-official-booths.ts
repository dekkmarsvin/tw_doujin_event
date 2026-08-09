import type { Booth } from "./ff47-booths";

export const FF47_OFFICIAL_BOOTH_LIST_URLS = {
  1: "https://www.f-2.com.tw/%E3%80%90ff47%E3%80%91%E7%AC%AC%E4%B8%80%E5%A4%A9%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F/",
  2: "https://www.f-2.com.tw/%E3%80%90ff47%E3%80%91%E7%AC%AC%E4%BA%8C%E5%A4%A9%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F/",
  3: "https://www.f-2.com.tw/%E3%80%90ff47%E3%80%91%E7%AC%AC%E4%B8%89%E5%A4%A9%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F/",
} as const;

type OfficialNameSupplement = {
  day: Booth["day"];
  codes: readonly string[];
  name: string;
  genre: Booth["genre"];
  tone: Booth["tone"];
};

// These circles already exist in the reviewed workbook, but their placement
// cells are empty. The organizer's daily lists are the placement authority;
// this supplement fills only booth/day keys missing from the workbook payload.
const OFFICIAL_NAME_SUPPLEMENTS = [
  { day: 1, codes: ["J09", "J10"], name: "+喵耳園魔法道具屋+", genre: "手作・模型", tone: "amber" },
  { day: 2, codes: ["J09", "J10"], name: "+喵耳園魔法道具屋+", genre: "手作・模型", tone: "amber" },
  { day: 2, codes: ["R01", "R02"], name: "+Ely Cosplay+", genre: "Cosplay", tone: "lilac" },
  { day: 3, codes: ["R01", "R02"], name: "+Ely Cosplay+", genre: "Cosplay", tone: "lilac" },
] as const satisfies readonly OfficialNameSupplement[];

const OFFICIAL_SUPPLEMENT_KEYS = new Set(OFFICIAL_NAME_SUPPLEMENTS.flatMap(({ day, codes }) => codes.map((code) => `${day}:${code}`)));

export function isFF47OfficialNameSupplement(day: Booth["day"], code: string) {
  return OFFICIAL_SUPPLEMENT_KEYS.has(`${day}:${code}`);
}

const rowY: Record<string, number> = {
  J: 45.12,
  R: 80.96,
};

export const FF47_OFFICIAL_NAME_BOOTHS: Booth[] = OFFICIAL_NAME_SUPPLEMENTS.flatMap(({ day, codes, name, genre, tone }) => codes.map((code) => ({
  id: `${day}-${code.toLocaleLowerCase()}`,
  code,
  name,
  pen: "",
  genre,
  tags: [],
  day,
  hall: code < "L" ? "A" : "B",
  x: +(2.8 + (Number(code.slice(1)) - 1) * 2.16).toFixed(2),
  y: rowY[code[0]],
  tone,
  work: "尚未提供作品分類",
  note: `社團名稱由開拓動漫 FF47 第 ${day} 天攤位清單補入；販售資訊以社團與現場公告為準。`,
})));
