import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { formatTaipeiTime, loginLinkLetter, renderLetter } = await environment.runner.import("/app/mail-letter.ts");
after(() => vite.close());

const ORIGIN = "https://map.kotoban.top";
const REQUESTED_AT = Date.UTC(2026, 8, 23, 6, 2);
const HREF = `${ORIGIN}/circle?event=ff47&login=Tok-en_123`;

function letter(overrides = {}) {
  return {
    kind: "general",
    subject: "「星塵製圖所」認領已核准",
    preheader: "現在可以補充代表圖、介紹、作者與連結。",
    category: "社團認領",
    title: "「星塵製圖所」認領已核准",
    paragraphs: ["現在可以補充代表圖、介紹、作者與連結。"],
    origin: ORIGIN,
    ...overrides,
  };
}

test("times are written in Taiwan time, across the date line too", () => {
  assert.equal(formatTaipeiTime(REQUESTED_AT), "2026.09.23 14:02");
  assert.equal(formatTaipeiTime(Date.UTC(2026, 11, 31, 16, 5)), "2027.01.01 00:05");
});

test("the login letter keeps the link alone on one line of the text part", () => {
  // The preview sink stores only the text part, and the E2E driver and the
  // handler tests pull the token out of it with this exact pattern.
  const mail = loginLinkLetter({ href: HREF, origin: ORIGIN, requestedAt: REQUESTED_AT, expiresAt: REQUESTED_AT + 15 * 60_000 });
  assert.equal(mail.subject, "場刊 Map 登入連結");
  assert.ok(mail.text.split("\n").includes(HREF));
  assert.equal(mail.text.match(/login=([^\s]+)/)[1], "Tok-en_123");
  assert.match(mail.text, /有效至：2026\.09\.23 14:17/);
  assert.match(mail.text, /如果你沒有申請登入/);
  assert.doesNotMatch(mail.text, /<[a-z]/i, "the text part carries no markup");
});

test("the login letter's HTML carries the same link on the button and as copyable text", () => {
  const mail = loginLinkLetter({ href: HREF, origin: ORIGIN, requestedAt: REQUESTED_AT, expiresAt: REQUESTED_AT + 15 * 60_000 });
  const escaped = HREF.replaceAll("&", "&#38;");
  assert.equal(mail.html.split(`href="${escaped}"`).length - 1, 2, "button and fallback link");
  assert.match(mail.html, /2026\.09\.23 14:02/);
  assert.match(mail.html, /2026\.09\.23 14:17/);
  assert.match(mail.html, /15 分鐘內有效，只能使用一次。/, "preheader");
  assert.match(mail.html, /<html lang="zh-Hant">/);
  assert.doesNotMatch(mail.html, /<style|<svg|<img|<script/i, "nothing a mail client strips or blocks");
});

test("every caller-supplied string is escaped in the HTML and left as written in the text", () => {
  const mail = renderLetter(letter({
    title: "<script>alert(1)</script> & 「社團」",
    paragraphs: ['"quoted" \'single\''],
    facts: [{ label: "攤位", value: "<b>B07</b>", data: true }],
    action: { label: "查看", href: `${ORIGIN}/?a=1&b="x"` },
  }));
  assert.doesNotMatch(mail.html, /<script>|<b>B07/);
  assert.match(mail.html, /&#60;script&#62;alert\(1\)&#60;\/script&#62; &#38; 「社團」/);
  assert.match(mail.html, /href="https:\/\/map\.kotoban\.top\/\?a=1&#38;b=&#34;x&#34;"/);
  assert.match(mail.text, /^<script>alert\(1\)<\/script> & 「社團」$/m);
});

test("only an urgent letter changes the subject and draws the warning band", () => {
  const general = renderLetter(letter());
  const system = renderLetter(letter({ kind: "system" }));
  const urgent = renderLetter(letter({ kind: "urgent", subject: "「星塵製圖所」攤位已變更為 C12", category: "攤位異動" }));

  assert.equal(general.subject, "「星塵製圖所」認領已核准");
  assert.equal(urgent.subject, "【重要】「星塵製圖所」攤位已變更為 C12");
  assert.equal(general.html, system.html, "general and system share one look");
  assert.doesNotMatch(general.html, /#fff7df/);
  assert.match(urgent.html, /background-color:#fff7df/);
  assert.match(urgent.html, /<title>【重要】「星塵製圖所」攤位已變更為 C12<\/title>/);
});

test("the footer points back to the origin the letter was sent from", () => {
  const mail = renderLetter(letter({ origin: "https://pr-12.tw-catalog.pages.dev" }));
  assert.match(mail.html, /href="https:\/\/pr-12\.tw-catalog\.pages\.dev" style="[^"]*">pr-12\.tw-catalog\.pages\.dev<\/a>/);
  assert.match(mail.text, /場刊 Map · https:\/\/pr-12\.tw-catalog\.pages\.dev\n$/);
  assert.match(mail.html, /mailto:circle@kotoban\.top/);
});
