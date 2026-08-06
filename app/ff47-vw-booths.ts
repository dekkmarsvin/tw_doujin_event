import type { Booth, Tone } from "./ff47-booths";

type SourceRow = readonly [
  name: string,
  pen: string,
  day1: string,
  day2: string,
  day3: string,
  creatorType: string,
  rating: string,
  workType: string,
  referencedWork: string,
];

// Public FF47 catalog rows whose placements include V01-V44 or W01-W42.
// Kept as source-shaped tuples so the generated placement records stay reviewable.
const SOURCE_ROWS = [
  ["千煂+BS", "塗鴉", "", "V06", "V05,V06", "繪師", "", "", ""],
  ["大幼蟲", "", "", "V01,V02", "V01,V02", "繪師", "", "", ""],
  ["大福喵喵", "喵大福", "", "", "V28", "繪師", "", "", ""],
  ["小白鹿 WHITE DEER", "", "", "", "V12", "繪師", "", "", ""],
  ["六太日日人", "", "V03", "V34", "", "繪師，香港", "", "", ""],
  ["心動美栗", "", "V17,V18", "", "V21,V22", "繪師", "", "二創", "葬送的芙莉蓮"],
  ["比鄰星域ProximaSector", "", "V43,V44", "V44", "", "vtuber", "", "原創", ""],
  ["北極雪兔窩", "兎寒Usamu", "V34", "", "", "繪師，Coser，Vtype", "一般", "原創", ""],
  ["卯時日和", "Darkpi", "", "V11", "V11", "繪師", "", "二創", "請問您今天要來點兔子嗎? / Is the order a rabbit? / ご注文はうさぎですか?"],
  ["奶油栗子大棕熊", "歪", "", "", "V17", "繪師", "", "", ""],
  ["瓜子工坊", "", "V04", "V35", "", "繪師", "", "", ""],
  ["交大 VTuber 社", "", "", "V31", "V31", "學生社團", "", "", ""],
  ["交大動畫社", "", "", "V30", "V30", "學生社團", "", "", ""],
  ["地獄熱炒店", "", "W23,W24", "W23,W24", "W23,W24", "繪師", "", "", ""],
  ["好緊先生", "好緊(TIGHT)", "", "V18", "V18", "繪師", "R18", "二創", "葬送的芙莉蓮，上伊那牡丹，醉姿如百合"],
  ["百元肉肉", "", "", "V05", "V32", "繪師", "", "", ""],
  ["百變恩恩", "", "W28", "", "", "COSER", "", "", ""],
  ["佐川千尋", "千尋", "W21,W22", "W21,W22", "", "Coser", "", "", ""],
  ["快樂罌粟花自耕農會", "", "V19", "", "", "繪師", "", "二創", "葬送的芙莉蓮"],
  ["芋粿子", "紅豆子(あずきこ)", "V01,V02", "", "", "繪師,漫畫作家", "R18", "二創", "戀上換裝娃娃"],
  ["狐狐君", "白云", "W27", "", "", "Coser", "", "", ""],
  ["花屋創意(花屋la fleur)", "", "V15,V16", "V15,V16", "", "繪師", "", "", ""],
  ["花絵の万貨-AORI個人勢", "青凛", "V33", "", "", "台灣Vtuber個人勢", "", "", ""],
  ["阿提Mzcca", "月球租客", "", "", "V23,V24", "繪師", "", "", ""],
  ["雨波HaneAme", "", "W41,W42", "W41,W42", "W41,W42", "coser", "", "", ""],
  ["星花火", "", "W33,W34", "W33,W34", "W33,W34", "繪師", "", "二創", "MyGO!!!!!、Ave Mujica"],
  ["春ばる繪屋", "春ばる", "V06", "", "V33", "繪師", "", "二創", "孤獨搖滾"],
  ["背骨貓屋", "背骨貓、星合", "W31,W32", "W31,W32", "W31,W32", "繪師", "一般", "原創", ""],
  ["風林火山 Naturefour", "Mocha", "W35,W36", "W35,W36", "W35,W36", "繪師, 香港", "", "二創", "請問您今天要來點兔子嗎? / Is the order a rabbit? / ご注文はうさぎですか??"],
  ["風雨陰晴故事販賣鋪", "", "V12", "", "", "繪師", "", "", ""],
  ["風鈴檔案W.C.A", "", "V35,V36", "", "V43,V44", "vtuber", "一般", "原創", ""],
  ["倫語project", "ASLE", "", "", "V25,V26", "繪師", "", "", ""],
  ["消波ブロック社", "Mr.Lime", "W15,W16", "W15,W16", "W15,W16", "繪師", "一般", "二創", "Hololive, Towa、明日方舟"],
  ["深海商舖", "", "V37", "", "", "", "", "", ""],
  ["猛少女之拳", "忽田各", "", "V39,V40", "V39,V40", "繪師,同人漫畫作家", "一般", "二創", "鬼滅之刃，我推的孩子"],
  ["盛櫻之汀", "", "", "V20", "V20", "繪師", "", "", "葬送的芙莉蓮"],
  ["陪騎的快樂小舖", "", "V09", "", "V13", "繪師", "", "", ""],
  ["晴時陰偶陣雨工作室", "冰川冥", "V11", "", "", "繪師", "", "", ""],
  ["無病習齋", "", "", "", "V34", "繪師，日本", "", "", ""],
  ["菟吉珍珠販售店", "千千菟", "V21,V22", "V21,V22", "", "繪師", "一般", "二創", "葬送的芙莉蓮、鏈鋸人、蕾潔"],
  ["超斬開", "夏阿特", "W13,W14", "W13,W14", "", "繪師", "", "", ""],
  ["黑毛圈圈", "", "", "", "V42", "vtuber", "", "", ""],
  ["黑白工房", "", "", "V14", "", "繪師", "", "", "光之美少女《名偵探光之美少女》，露露卡"],
  ["黑桐heton", "", "V08", "", "", "繪師", "", "", ""],
  ["黑嚕嚕的六華貓", "", "", "", "V14", "繪師", "", "", ""],
  ["稚稚丸", "稚稚丸", "", "", "V27", "繪師", "R18", "二創", ""],
  ["鈴屋", "REI", "W09,W10", "W09,W10", "W09,W10", "繪師", "", "", ""],
  ["雷光刻幻", "", "", "V19", "V19", "手工藝品", "", "", ""],
  ["瑠璃瑠璃企画", "", "", "V07", "V07", "繪師", "", "", ""],
  ["緋紅工房", "", "V07", "", "", "繪師", "", "", ""],
  ["銅雀台", "", "V27,V28", "V27,V28", "", "", "", "", ""],
  ["踏雪嗚哇", "", "V39", "", "", "Vtuber", "", "", ""],
  ["醉宮Yomiya", "", "W25,W26", "", "W21,W22", "Coser", "", "", ""],
  ["儒宅 Ruzhai", "儒宅 Ruzhai", "W19,W20", "W19,W20", "W19,W20", "繪師", "R15", "二創", "鳴潮 / Wuthering Waves"],
  ["貓咪窩", "", "", "V29", "V15,V16", "繪師", "", "", "間諜家家酒"],
  ["貓專用牛乳", "那須花花", "", "V09,V10", "V09,V10", "繪師", "", "二創", "請問您今天要來點兔子嗎? / Is the order a rabbit? / ご注文はうさぎですか?，名偵探光之美少女"],
  ["歸宅本部", "", "", "V38", "V38", "", "", "", ""],
  ["壞菇社", "凡爾賽菇雞三世、4why", "V23,V24", "V23,V24", "", "繪師", "", "", ""],
  ["蘿蔔農學院", "蘿蔔", "", "V08", "V08", "繪師", "", "二創", "鬼滅之刃"],
  ["罐子牧場", "罐子", "", "", "W13,W14", "繪師", "", "", ""],
  ["AZURE DRAGON", "", "", "V41", "V41", "Coser，日本", "", "二創", "機動戰士鋼彈 水星的魔女"],
  ["Beebeebunny", "BeeBee", "V29,V30", "V42", "", "繪師，香港", "一般", "二創", "庫洛魔法使"],
  ["BIYA", "", "W03,W04", "W03,W04", "W03,W04", "Coser", "", "", ""],
  ["Bubble Wave", "", "", "", "W11,W12", "繪師", "", "", ""],
  ["Bygin-白巾", "Bygin-白巾", "W17,W18", "W17,W18", "W17,W18", "繪師", "", "二創", "葬送的芙莉蓮"],
  ["Catity cosplay", "Caity", "W39,W40", "W39,W40", "W39,W40", "Coser", "", "", ""],
  ["chested", "", "V32", "V32", "", "繪師", "", "", ""],
  ["coneco.Y. (洋食小貓)", "", "W11,W12", "W11,W12", "", "同人社團", "", "", ""],
  ["CY Future", "", "V38", "", "", "Vtuber", "", "", ""],
  ["DAMAO閑駒樓", "", "V10", "", "", "繪師", "", "二創", "光之美少女《名偵探光之美少女》，露露卡"],
  ["DISH", "", "W05,W06", "W05,W06", "W05,W06", "繪師", "", "", ""],
  ["EMO個人", "", "", "V17", "", "繪師", "", "", "葬送的芙莉蓮"],
  ["Gmi", "居小米", "V40", "", "", "繪師", "", "", ""],
  ["Goro", "伊織萌", "", "W27,W28", "W27,W28", "Coser，日本", "", "", ""],
  ["HAONI", "HAONI", "V25,V26", "V25,V26", "", "繪師", "R18", "二創", "無職轉生"],
  ["ISWUWUWU", "", "", "V43", "", "繪師", "", "", ""],
  ["K_Pring", "", "W02", "W02", "W02", "繪師", "", "", ""],
  ["KAZUYA", "", "V14", "", "", "", "", "二創", "葬送的芙莉蓮"],
  ["Lolipop Complete", "", "", "", "V29", "繪師, 日本", "", "", ""],
  ["MIBRY", "", "", "V03,V04", "V03,V04", "繪師", "R18", "原創", ""],
  ["MiruMiu", "", "V13", "V13", "", "繪師", "", "", ""],
  ["NAK", "", "V31", "V33", "", "繪師", "", "二創", "無職轉生，希露菲"],
  ["Neko2AirLine", "", "W29,W30", "W29,W30", "W29,W30", "COSER，日本", "", "", ""],
  ["NTUCCC台大卡漫社", "", "", "V36", "V36", "學生社團", "", "", ""],
  ["Rabbit Candy", "狐狸,タク道", "", "V12", "", "繪師,代理社團", "", "二創", "請問您今天要來點兔子嗎? / Is the order a rabbit? / ご注文はうさぎですか??"],
  ["REI’s ROOM", "", "W07,W08", "W07,W08", "W07,W08", "繪師", "", "", "學園偶像大師 / Gakuen IDOLM@STER /学園アイドルマスター"],
  ["SAKI-LAND", "Mocha", "W37,W38", "W37,W38", "W37,W38", "繪師，香港", "", "", ""],
  ["SamoAgo", "狗狗", "V41,V42", "", "", "台灣Vtuber個人勢", "", "", ""],
  ["Socotaku帝大社研宅學組", "Mark, SH", "", "V37", "V37", "動漫評論, 資料型同人誌", "", "", ""],
  ["T.K.C", "", "V20", "", "", "繪師", "一般", "二創", "葬送的芙莉蓮"],
  ["Turbo Wing", "", "V05", "", "", "繪師，香港", "", "", ""],
  ["XIxeong", "", "W01", "W01", "W01", "繪師，日本", "", "", ""],
  ["いおいおいおりん", "伊織萌", "", "W25,W26", "W25,W26", "Coser，日本", "", "", ""],
  ["みゆる〜む伊月的空間", "いづき", "", "", "V35", "繪師，日本", "", "二創", "幸運星"],
] as const satisfies readonly SourceRow[];

function classify(creatorType: string): { genre: Booth["genre"]; tone: Tone } {
  const value = creatorType.toLocaleLowerCase();
  if (value.includes("代理社團")) return { genre: "代理社團", tone: "coral" };
  if (value.includes("coser")) return { genre: "Cosplay", tone: "lilac" };
  if (value.includes("vtuber") || value.includes("vtype")) return { genre: "VTuber", tone: "blue" };
  if (/手工|手作|模型/.test(value)) return { genre: "手作・模型", tone: "amber" };
  if (value.includes("學生社團")) return { genre: "學生社團", tone: "mint" };
  return { genre: "繪圖・創作", tone: "mint" };
}

function placementCodes(value: string) {
  return (value.toUpperCase().match(/[VW]\d{1,2}/g) ?? []).map((code) => `${code[0]}${code.slice(1).padStart(2, "0")}`);
}

function coordinate(code: string) {
  const number = Number(code.slice(1));
  return { x: +(2.8 + (number - 1) * 2.16).toFixed(2), y: code.startsWith("V") ? 98.88 : 100 };
}

export const V_W_BOOTHS: Booth[] = SOURCE_ROWS.flatMap(([name, pen, day1, day2, day3, creatorType, rating, workType, referencedWork]) => {
  const { genre, tone } = classify(creatorType);
  const work = referencedWork || workType || creatorType || "創作者";
  const tags = [rating, workType].filter(Boolean);
  const creator = pen ? `創作者：${pen}。` : "";
  const description = creatorType || "創作者";
  const note = `${creator}${description}${rating ? `，分級 ${rating}` : ""}。完整品項與庫存請以現場公告為準。`;

  return [day1, day2, day3].flatMap((placements, index) => placementCodes(placements).map((code) => ({
    id: `${index + 1}-${code.toLocaleLowerCase()}`,
    code,
    name,
    pen,
    genre,
    tags,
    day: (index + 1) as Booth["day"],
    hall: "B" as const,
    ...coordinate(code),
    tone,
    work,
    note,
  })));
});
