/**
 * Letters the site sends, in the 作戰桌 layout: a brand row, one card holding a
 * category line, title, facts and a single action, and a footer.
 *
 * Every letter goes out twice, as HTML and as plain text. The text part is not
 * a courtesy copy: the preview mail sink stores only it, and the E2E driver and
 * the handler tests read the login link out of it, so an action URL always
 * stands alone on its own line there.
 *
 * Mail clients are not browsers. Gmail drops `<style>` and web fonts, Outlook
 * ignores flex, margins and max-width, and a font set on a table does not
 * reach the cells inside it. So the HTML is nested tables with every style
 * inline and repeated where text sits, system font stacks, and nothing that
 * needs an image or SVG to carry meaning. What only some clients draw — round
 * corners, the brand tile's gold offset — degrades to square and flat, never
 * to missing.
 */

export type LetterKind = "general" | "system" | "urgent";

export type LetterFact = {
  label: string;
  value: string;
  /** Comparable or positional values — times, booth codes — are set in mono. */
  data?: boolean;
  /** Makes the value a link; the text part prints the URL on the next line. */
  href?: string;
};

export type Letter = {
  /**
   * `general` and `system` look the same; the kind records what the letter is
   * for. `urgent` is the one that changes the letter: a warning band across
   * the card's top line and 【重要】 in front of the subject.
   */
  kind: LetterKind;
  subject: string;
  /** The line an inbox shows after the subject; hidden in the body. */
  preheader: string;
  /** What the letter is about, on the left of the card's top line. */
  category: string;
  /** Already formatted, on the right of the card's top line. */
  stamp?: string;
  title: string;
  paragraphs: string[];
  facts?: LetterFact[];
  action?: { label: string; href: string };
  /** Also print the action URL, for clients and scanners that break the button. */
  showActionUrl?: boolean;
  /** Small print at the foot of the card. */
  notes?: string[];
  /** A link in the footer, above the support address — e.g. the recipient's settings. */
  footerLink?: { label: string; href: string };
  /** This site's origin; the footer links back to it. */
  origin: string;
};

export type RenderedLetter = { subject: string; text: string; html: string };

const SUPPORT_ADDRESS = "circle@kotoban.top";

const SANS = "-apple-system,BlinkMacSystemFont,'PingFang TC','Noto Sans TC','Microsoft JhengHei',system-ui,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";

const INK = "#202a35";
// Not the design system's text-muted (#707a82): that is 4.08:1 on the paper
// ground, and a letter's small print is read on a phone. This is the reader's
// own darker secondary grey, 5.8:1 on paper and 6.2:1 on the card.
const MUTED = "#59626c";
const LINE = "#dfe3df";
const PAPER = "#f8f7f2";
const CARD = "#ffffff";
const WELL = "#f2f0e8";
const LINK = "#306d59";
const ON_INK = "#f9faf8";
const GOLD = "#f4c65c";
const WARNING = { soft: "#fff7df", line: "#d5b776", deep: "#6e5324", mark: "#d59b37" };

const TABLE = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function text(size: number, lineHeight: number, rest = "") {
  return `font-family:${SANS};font-size:${size}px;line-height:${lineHeight}px;${rest}`;
}

/** `2026.09.23 14:17` in Taiwan time, which has no daylight saving to track. */
export function formatTaipeiTime(epochMs: number) {
  const shifted = new Date(epochMs + 8 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}.${pad(shifted.getUTCMonth() + 1)}.${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

function renderText(letter: Letter) {
  const blocks = [letter.title, ...letter.paragraphs];
  if (letter.facts?.length) {
    blocks.push(letter.facts.map((fact) => `${fact.label}：${fact.value}${fact.href ? `\n${fact.href}` : ""}`).join(letter.facts.some((fact) => fact.href) ? "\n\n" : "\n"));
  }
  if (letter.action) blocks.push(`${letter.action.label}：\n${letter.action.href}`);
  blocks.push(...(letter.notes ?? []));
  const footerLink = letter.footerLink ? `${letter.footerLink.label}：${letter.footerLink.href}\n` : "";
  blocks.push(`-- \n${footerLink}使用問題請寄 ${SUPPORT_ADDRESS}\n場刊 Map · ${letter.origin}`);
  return `${blocks.join("\n\n")}\n`;
}

function brandRow() {
  return `<table ${TABLE}><tr>`
    + `<td width="38" height="38" align="center" valign="middle" bgcolor="${INK}" aria-hidden="true" style="width:38px;height:38px;background-color:${INK};border-radius:11px 11px 11px 3px;box-shadow:3px 3px 0 ${GOLD};${text(19, 38, `font-weight:900;color:${ON_INK};`)}">場</td>`
    + `<td valign="middle" style="padding-left:12px;">`
    + `<div style="${text(16, 21, `font-weight:700;letter-spacing:0.08em;color:${INK};`)}">場刊 Map</div>`
    + `<div style="${text(11, 15, `letter-spacing:0.12em;color:${MUTED};`)}">同人展逛攤地圖</div>`
    + `</td></tr></table>`;
}

function topLine(letter: Letter) {
  const urgent = letter.kind === "urgent";
  const color = urgent ? WARNING.deep : MUTED;
  const label = `<span style="${text(11, 16, `font-weight:800;letter-spacing:0.1em;color:${color};`)}">${escapeHtml(letter.category)}</span>`;
  // The mark is a glyph in a filled cell rather than an icon: Gmail shows no
  // SVG, and an image would be blocked by default. The words carry the meaning.
  const left = urgent
    ? `<table ${TABLE}><tr>`
      + `<td width="22" height="22" align="center" valign="middle" bgcolor="${WARNING.mark}" aria-hidden="true" style="width:22px;height:22px;background-color:${WARNING.mark};border-radius:6px;${text(14, 22, "font-weight:900;color:#ffffff;")}">!</td>`
      + `<td valign="middle" style="padding-left:10px;">${label}</td>`
      + `</tr></table>`
    : label;
  const stamp = letter.stamp
    ? `<td align="right" valign="middle" style="font-family:${MONO};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.06em;color:${color};">${escapeHtml(letter.stamp)}</td>`
    : "";
  const band = urgent
    ? `background-color:${WARNING.soft};border-bottom:1px solid ${WARNING.line};border-radius:11px 11px 0 0;`
    : `border-bottom:1px solid ${LINE};`;
  return `<td ${urgent ? `bgcolor="${WARNING.soft}" ` : ""}style="padding:14px 24px;${band}">`
    + `<table ${TABLE} width="100%"><tr><td align="left" valign="middle">${left}</td>${stamp}</tr></table>`
    + `</td>`;
}

function factsTable(facts: LetterFact[]) {
  // The label column is at least 76px and grows to its longest label rather
  // than wrapping one; a digest labels its rows with a kind and an event code.
  const rows = facts.map((fact) => {
    const value = escapeHtml(fact.value);
    return `<tr>`
      + `<td width="76" valign="top" style="width:76px;white-space:nowrap;padding:10px 16px 10px 0;border-bottom:1px solid ${LINE};${text(13, 20, `color:${MUTED};`)}">${escapeHtml(fact.label)}</td>`
      + `<td valign="top" style="padding:10px 0;border-bottom:1px solid ${LINE};overflow-wrap:anywhere;word-break:break-word;font-family:${fact.data ? MONO : SANS};font-size:14px;line-height:20px;font-weight:700;${fact.data ? "letter-spacing:0.04em;" : ""}color:${INK};">`
      + (fact.href ? `<a href="${escapeHtml(fact.href)}" style="color:${LINK};">${value}</a>` : value)
      + `</td></tr>`;
  }).join("");
  return `<table ${TABLE} width="100%" style="border-top:1px solid ${LINE};">${rows}</table>`;
}

function button(action: { label: string; href: string }) {
  return `<table ${TABLE}><tr>`
    + `<td bgcolor="${INK}" style="background-color:${INK};border-radius:7px;">`
    + `<a href="${escapeHtml(action.href)}" style="display:inline-block;padding:12px 22px;${text(15, 20, `font-weight:700;color:${ON_INK};text-decoration:none;`)}border-radius:7px;">${escapeHtml(action.label)}</a>`
    + `</td></tr></table>`;
}

function actionUrl(href: string) {
  const escaped = escapeHtml(href);
  return `<table ${TABLE} width="100%">`
    + `<tr><td style="padding-top:20px;border-top:1px solid ${LINE};"><p style="margin:0;${text(13, 22, `color:${MUTED};`)}">按鈕無法開啟時，把這個網址貼到瀏覽器：</p></td></tr>`
    + `<tr><td style="padding-top:8px;"><table ${TABLE} width="100%"><tr>`
    + `<td style="padding:10px 12px;background-color:${WELL};border:1px solid ${LINE};border-radius:7px;font-family:${MONO};font-size:12px;line-height:19px;color:${INK};word-break:break-all;">`
    + `<a href="${escaped}" style="color:${INK};text-decoration:none;word-break:break-all;">${escaped}</a>`
    + `</td></tr></table></td></tr></table>`;
}

function renderHtml(letter: Letter, subject: string) {
  const row = (paddingTop: number, content: string) => `<tr><td style="padding-top:${paddingTop}px;">${content}</td></tr>`;
  const body = [
    `<tr><td><h1 style="margin:0;${text(20, 27, `font-weight:700;color:${INK};`)}">${escapeHtml(letter.title)}</h1></td></tr>`,
    ...letter.paragraphs.map((paragraph) => row(10, `<p style="margin:0;${text(15, 26, `color:${INK};`)}">${escapeHtml(paragraph)}</p>`)),
  ];
  if (letter.facts?.length) body.push(row(20, factsTable(letter.facts)));
  if (letter.action) {
    body.push(row(24, button(letter.action)));
    if (letter.showActionUrl) body.push(row(24, actionUrl(letter.action.href)));
  }
  for (const note of letter.notes ?? []) body.push(row(16, `<p style="margin:0;${text(13, 22, `color:${MUTED};`)}">${escapeHtml(note)}</p>`));

  const origin = escapeHtml(letter.origin);
  const host = escapeHtml(new URL(letter.origin).host);
  const footerLink = letter.footerLink
    ? `<a href="${escapeHtml(letter.footerLink.href)}" style="color:${LINK};">${escapeHtml(letter.footerLink.label)}</a><br>`
    : "";
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(letter.preheader)}${"&zwnj;&nbsp;".repeat(60)}</div>
<table ${TABLE} width="100%" bgcolor="${PAPER}" style="background-color:${PAPER};">
<tr><td align="center" style="padding:32px 16px 40px;">
<!--[if mso]><table ${TABLE} width="560"><tr><td><![endif]-->
<table ${TABLE} width="100%" style="max-width:560px;">
<tr><td style="padding-bottom:20px;">${brandRow()}</td></tr>
<tr><td bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${LINE};border-radius:12px;">
<table ${TABLE} width="100%">
<tr>${topLine(letter)}</tr>
<tr><td style="padding:24px 24px 28px;"><table ${TABLE} width="100%">${body.join("")}</table></td></tr>
</table>
</td></tr>
<tr><td style="padding:20px 4px 0;${text(12, 20, `color:${MUTED};`)}">${footerLink}使用問題請寄 <a href="mailto:${SUPPORT_ADDRESS}" style="color:${LINK};">${SUPPORT_ADDRESS}</a><br>場刊 Map · <a href="${origin}" style="color:${LINK};">${host}</a></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

export function renderLetter(letter: Letter): RenderedLetter {
  const subject = letter.kind === "urgent" ? `【重要】${letter.subject}` : letter.subject;
  return { subject, text: renderText(letter), html: renderHtml(letter, subject) };
}

/** The one-time sign-in link, for either entry; `href` already carries the token. */
export function loginLinkLetter({ href, origin, requestedAt, expiresAt }: {
  href: string;
  origin: string;
  requestedAt: number;
  expiresAt: number;
}) {
  const minutes = Math.round((expiresAt - requestedAt) / 60_000);
  return renderLetter({
    kind: "system",
    subject: "場刊 Map 登入連結",
    preheader: `${minutes} 分鐘內有效，只能使用一次。`,
    category: "登入",
    stamp: formatTaipeiTime(requestedAt),
    title: "登入場刊 Map",
    paragraphs: ["連結只能使用一次。"],
    facts: [{ label: "有效至", value: formatTaipeiTime(expiresAt), data: true }],
    action: { label: "登入", href },
    showActionUrl: true,
    notes: ["如果你沒有申請登入，請忽略這封信，不會有任何變更。"],
    origin,
  });
}

/**
 * A sign-in link someone else minted, for a person who may read it long after
 * it expires. Any organizer sign-in accepts the address's pending invitations,
 * so the letter says where to ask for a fresh link instead of leaving a dead one.
 */
export function organizerInvitationLetter({ href, origin, requestedAt, expiresAt, eventName, inviterRole }: {
  href: string;
  origin: string;
  requestedAt: number;
  expiresAt: number;
  eventName: string;
  inviterRole: "admin" | "owner";
}) {
  const minutes = Math.round((expiresAt - requestedAt) / 60_000);
  return renderLetter({
    kind: "system",
    subject: "場刊 Map 主辦工作區邀請",
    preheader: `你已受邀管理一場活動，連結 ${minutes} 分鐘內有效。`,
    category: "主辦邀請",
    stamp: formatTaipeiTime(requestedAt),
    title: "你已受邀管理一場活動",
    paragraphs: ["登入後會進入主辦工作區。連結只能使用一次。"],
    facts: [
      { label: "活動", value: eventName },
      { label: "邀請者", value: inviterRole === "admin" ? "網站管理者" : "活動負責人" },
      { label: "有效至", value: formatTaipeiTime(expiresAt), data: true },
    ],
    action: { label: "登入主辦工作區", href },
    showActionUrl: true,
    notes: [
      `連結過期後，到 ${new URL("/organizer", origin).href} 用這個信箱重新索取登入連結即可。`,
      "如果你不認識這項邀請，請忽略這封信。",
    ],
    origin,
  });
}
