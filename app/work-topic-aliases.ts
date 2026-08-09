export type WorkTopicAliasGroup = {
  canonical: string;
  aliases: readonly string[];
};

/**
 * Reviewed cross-language names used by work-topic search.
 * Keep this table explicit: aliases affect discovery but never rewrite source data.
 */
export const WORK_TOPIC_ALIAS_GROUPS: readonly WorkTopicAliasGroup[] = [
  {
    canonical: "賽馬娘 Pretty Derby",
    aliases: ["賽馬娘", "ウマ娘", "ウマ娘Pretty Derby", "ウマ娘 プリティーダービー", "Uma Musume Pretty Derby"],
  },
  {
    canonical: "米哈遊",
    aliases: ["miHoYo", "HoYoverse"],
  },
  {
    canonical: "原神",
    aliases: ["Genshin Impact"],
  },
  {
    canonical: "崩壞：星穹鐵道",
    aliases: ["崩壞星穹鐵道", "Honkai: Star Rail", "崩壊：スターレイル", "崩壊:スターレイル"],
  },
  {
    canonical: "蔚藍檔案",
    aliases: ["Blue Archive", "ブルーアーカイブ"],
  },
  {
    canonical: "絕區零",
    aliases: ["Zenless Zone Zero", "ZenlessZoneZero", "ゼンレスゾーンゼロ"],
  },
  {
    canonical: "鳴潮",
    aliases: ["Wuthering Waves"],
  },
  {
    canonical: "勝利女神：妮姬",
    aliases: ["勝利女神妮姬", "NIKKE: The Goddess of Victory", "勝利の女神:NIKKE"],
  },
];
