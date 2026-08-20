/**
 * Emit `dist/privacy/index.html` from `docs/policy/privacy-notice.md`, served at
 * `/privacy`.
 *
 * The notice has to be reachable by someone who will never read this repo — a
 * notice that exists only as a Markdown file does not exist for the person
 * about to hand over an email address (ADR-0011, ADR-0023). It is generated
 * from that file rather than transcribed into a page, because a second copy is
 * a copy that drifts, and the one that drifts is always the published one.
 *
 * Plain HTML with no script and no bundle: the public reading path is static
 * and must never be served by a Pages Function (ADR-0008), and the overlay
 * already has the free plan's daily Function budget to itself (#48).
 *
 * The renderer covers exactly the Markdown the notice uses. It is deliberately
 * not a general one — `tests/privacy-page.test.mjs` fails the build if the
 * source grows a construct this cannot render, rather than letting a section
 * quietly vanish from the published page.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(root, "docs", "policy", "privacy-notice.md");
/**
 * A directory index, not `privacy.html`. `/privacy` then resolves the way every
 * static host resolves a directory, instead of relying on Pages stripping the
 * extension — the link is printed under a sign-in form, and a policy link that
 * 404s is worse than no link.
 */
const OUTPUT_DIR = resolve(root, "dist", "privacy");
const OUTPUT = resolve(OUTPUT_DIR, "index.html");

/** Repo-relative links have no meaning on the site; they resolve to GitHub. */
const REPO_BLOB = "https://github.com/dekkmarsvin/tw_doujin_event/blob/main/docs/policy/";

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function resolveHref(href) {
  if (/^(?:https?:|mailto:|#)/.test(href)) return href;
  // `../adr/0015-x.md` and friends: relative to the notice's own directory.
  return new URL(href, REPO_BLOB).toString();
}

/**
 * Inline spans.
 *
 * Split on code spans and render each piece on its own rather than swapping
 * them for placeholders: a placeholder is a token that has to survive every
 * later replacement, and the one that does not survive fails silently — the
 * text still looks present, just no longer marked up.
 */
export function renderInline(text) {
  return text.split(/(`[^`]+`)/).map((segment) => {
    if (segment.length > 1 && segment.startsWith("`") && segment.endsWith("`")) {
      return `<code>${escapeHtml(segment.slice(1, -1))}</code>`;
    }
    return escapeHtml(segment)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${escapeHtml(resolveHref(href))}">${label}</a>`)
      .replace(/&lt;(https?:\/\/[^\s>]+)&gt;/g, (_, href) => `<a href="${escapeHtml(href)}">${href}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  }).join("");
}

function renderTable(rows) {
  // Row two is the alignment rule; it carries no content.
  const [header, , ...body] = rows;
  const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const head = cells(header).map((cell) => `<th>${renderInline(cell)}</th>`).join("");
  const lines = body.map((row) => `<tr>${cells(row).map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`);
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${lines.join("")}</tbody></table></div>`;
}

/** One nesting level, which is all the notice uses (the contact addresses). */
function renderList(items) {
  const html = [];
  for (const item of items) {
    if (item.depth === 0) {
      html.push(`<li>${renderInline(item.text)}</li>`);
      continue;
    }
    const parent = html.pop();
    if (parent === undefined) throw new Error(`Nested list item with no parent: ${item.text}`);
    const nested = `<li>${renderInline(item.text)}</li>`;
    html.push(parent.endsWith("</ul></li>")
      ? parent.replace(/<\/ul><\/li>$/, `${nested}</ul></li>`)
      : parent.replace(/<\/li>$/, `<ul>${nested}</ul></li>`));
  }
  return `<ul>${html.join("")}</ul>`;
}

export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  const take = (predicate) => {
    const collected = [];
    while (index < lines.length && predicate(lines[index])) collected.push(lines[index++]);
    return collected;
  };

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) { index += 1; continue; }

    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      blocks.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`);
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) { blocks.push("<hr>"); index += 1; continue; }

    if (line.startsWith("> ")) {
      const quoted = take((candidate) => candidate.startsWith("> ")).map((candidate) => candidate.slice(2));
      blocks.push(`<blockquote>${quoted.map((entry) => `<p>${renderInline(entry)}</p>`).join("")}</blockquote>`);
      continue;
    }

    if (line.startsWith("|")) {
      blocks.push(renderTable(take((candidate) => candidate.startsWith("|"))));
      continue;
    }

    if (/^\s*- /.test(line)) {
      const items = take((candidate) => /^\s*- /.test(candidate)).map((candidate) => ({
        depth: /^\s{2,}- /.test(candidate) ? 1 : 0,
        text: candidate.replace(/^\s*- /, ""),
      }));
      blocks.push(renderList(items));
      continue;
    }

    const paragraph = take((candidate) => candidate.trim() !== "" && !/^(?:#{1,3} |> |\||\s*- |---+$)/.test(candidate));
    blocks.push(`<p>${renderInline(paragraph.join("\n"))}</p>`);
  }

  return blocks.join("\n");
}

/** The date the notice states, which is the one the page has to show. */
export function lastUpdatedFrom(markdown) {
  const match = /最後更新日期：(\d{4}-\d{2}-\d{2})/.exec(markdown);
  if (!match) throw new Error("The notice has no 最後更新日期; the published page must state one.");
  return match[1];
}

export function buildPrivacyPage(markdown) {
  const updated = lastUpdatedFrom(markdown);
  const body = renderMarkdown(markdown).split("\n").map((line) => `      ${line}`).join("\n");
  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f6f1e7" />
    <meta name="description" content="場刊 Map 如何蒐集、使用與保存資料，以及聯絡窗口。" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/fonts/geist.css" />
    <title>隱私權與資料使用告知｜場刊 Map</title>
    <style>
      :root { --ink: #202a35; --muted: #707a82; --line: #dfe3df; --paper: #f8f7f2; --accent: #a4563e; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 32px 18px 72px;
        background: #f1f0ea;
        color: var(--ink);
        font-family: Geist, system-ui, "Noto Sans TC", sans-serif;
        font-size: 15px;
        line-height: 1.85;
      }
      main { max-width: 46rem; margin: 0 auto; padding: 28px 26px 34px; border: 1px solid var(--line); border-radius: 14px; background: #fff; }
      nav { max-width: 46rem; margin: 0 auto 14px; font-size: 13px; }
      nav a, main a { color: var(--accent); }
      h1 { margin: 0 0 4px; font-size: 24px; line-height: 1.4; }
      h2 { margin: 34px 0 10px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 18px; }
      h3 { margin: 22px 0 8px; font-size: 15px; }
      p, ul { margin: 10px 0; }
      ul { padding-left: 22px; }
      li { margin: 4px 0; }
      code { padding: 1px 5px; border-radius: 4px; background: var(--paper); font-family: "Geist Mono", ui-monospace, monospace; font-size: .92em; }
      hr { margin: 26px 0; border: 0; border-top: 1px solid var(--line); }
      blockquote { margin: 14px 0; padding: 12px 14px; border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; background: var(--paper); font-size: 14px; }
      blockquote p { margin: 0; }
      .scroll { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
      th, td { padding: 8px 10px; border: 1px solid var(--line); text-align: left; vertical-align: top; }
      th { background: var(--paper); }
      footer { max-width: 46rem; margin: 16px auto 0; color: var(--muted); font-size: 12px; }
      @media (max-width: 480px) { body { padding: 20px 12px 56px; } main { padding: 20px 16px 26px; } }
    </style>
  </head>
  <body>
    <nav><a href="/">← 回到場刊 Map</a></nav>
    <main>
${body}
    </main>
    <footer>最後更新：${updated}．本頁由 docs/policy/privacy-notice.md 於建置時產生，兩者不會分歧。</footer>
  </body>
</html>
`;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(modulePath)) {
  const markdown = await readFile(SOURCE, "utf8");
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT, buildPrivacyPage(markdown), "utf8");
  console.log(`Generated dist/privacy/index.html from docs/policy/privacy-notice.md (updated ${lastUpdatedFrom(markdown)}).`);
}
