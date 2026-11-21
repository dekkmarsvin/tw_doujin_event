import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (relative) => readFile(path.join(ROOT, relative), "utf8");
const exists = (relative) => stat(path.join(ROOT, relative)).then(() => true, () => false);

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", ".vinext", ".wrangler", ".event-data", ".scratch"]);

async function markdownFiles(directory = "") {
  const entries = await readdir(path.join(ROOT, directory), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await markdownFiles(relative)));
    else if (entry.name.endsWith(".md")) found.push(relative);
  }
  return found;
}

test("every issue form enters the canonical triage flow", async () => {
  const forms = await Promise.all(["bug.yml", "feature.yml", "documentation.yml"]
    .map((name) => read(`.github/ISSUE_TEMPLATE/${name}`)));
  for (const form of forms) assert.match(form, /labels: \[[^\]]*"needs-triage"[^\]]*\]/);
  assert.match(await read(".github/ISSUE_TEMPLATE/config.yml"), /blank_issues_enabled: false/);
});

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
const slug = (heading) => heading
  .replace(/^#+\s*/, "")
  .toLowerCase()
  .trim()
  .replace(/[`*_[\]()]/g, "")
  .replace(/\s+/g, "-")
  .replace(/[^\p{Letter}\p{Number}-]/gu, "");

async function headingSlugs(relative) {
  const source = await read(relative);
  return new Set(source.split(/\r?\n/).filter((line) => /^#{1,6}\s/.test(line)).map(slug));
}

// Documentation is split across contracts, runbooks, ADRs and two indexes, so a
// move that leaves a link behind is the failure mode that actually happens.
// Anchors matter as much as paths: moving a section between files leaves the
// path valid and the anchor dangling.
test("every relative link between documents resolves, anchors included", async () => {
  const broken = [];
  const slugCache = new Map();
  for (const file of await markdownFiles()) {
    const source = await read(file);
    const directory = path.posix.dirname(file);
    for (const [, target, anchor] of source.matchAll(/\]\(([^)#\s]*)(?:#([^)\s]*))?\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const resolved = target === ""
        ? file
        : path.posix.normalize(path.posix.join(directory === "." ? "" : directory, target));
      if (!(await exists(resolved))) {
        broken.push(`${file} -> ${target}`);
        continue;
      }
      if (!anchor || !resolved.endsWith(".md")) continue;
      if (!slugCache.has(resolved)) slugCache.set(resolved, await headingSlugs(resolved));
      if (!slugCache.get(resolved).has(anchor.toLowerCase())) {
        broken.push(`${file} -> ${target}#${anchor} (no such heading)`);
      }
    }
  }
  assert.deepEqual(broken, [], `broken document links:\n${broken.join("\n")}`);
});
