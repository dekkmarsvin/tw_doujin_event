// Only known non-product inputs may avoid the product gate. This is an
// allowlist, not an inventory of product files: new paths default to full CI.
import { appendFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_DOCS = new Set(["AGENTS.md", "CONTEXT.md", "DESIGN.md", "PRODUCT.md", "README.md"]);
const TOOLING = new Set([".gitignore", ".claude/settings.json", ".claude/hooks/session-start.sh"]);
const ISSUE_FORMS = new Set(["bug.yml", "feature.yml", "documentation.yml", "config.yml"]);

export function classifyPaths(paths) {
  if (!paths.length) return { profile: "full", reason: "No changed paths; use the full gate." };
  let tooling = false;
  for (const file of paths) {
    if (TOOLING.has(file)) { tooling = true; continue; }
    if (ROOT_DOCS.has(file) || file === ".github/pull_request_template.md"
      || (file.startsWith(".github/ISSUE_TEMPLATE/") && ISSUE_FORMS.has(file.slice(".github/ISSUE_TEMPLATE/".length)))
      || /^docs\/(?:README\.md|(?:adr|agents|contracts|design|research|runbooks)\/.+\.md)$/.test(file)
      || /^docs\/design\/assets\/.+\.(?:png|jpg|jpeg|webp|svg|json)$/.test(file)
      || file.startsWith(".evidence/")) continue;
    return { profile: "full", reason: "Product, build, test infrastructure or unknown path changed." };
  }
  return { profile: tooling ? "tooling" : "docs", reason: "Every changed path is on the non-product allowlist." };
}

export function determineScope({ eventName, event, sha, cwd = process.cwd() }) {
  if (eventName === "workflow_dispatch") return { profile: "full", reason: "Manual dispatch retains the full deployment flow.", paths: [] };
  const base = eventName === "pull_request" ? event.pull_request?.base?.sha : eventName === "push" ? event.before : null;
  if (![base, sha].every(value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value))) {
    return { profile: "full", reason: "No verifiable comparison range; use the full gate.", paths: [] };
  }
  const git = args => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  // Never classify one version and then verify/deploy a different checkout.
  if (git(["rev-parse", "HEAD"]).trim() !== sha) throw new Error("CI checkout does not match the event SHA.");
  let diff;
  try {
    // A push can contain several commits. PRs compare the tested merge tree
    // with its base. Disabling rename detection checks BOTH old and new paths.
    diff = git(["diff", "--name-status", "-z", "--no-renames", base, sha, "--"]);
  } catch {
    return { profile: "full", reason: "Comparison history unavailable; use the full gate.", paths: [] };
  }
  const fields = diff.split("\0");
  if (fields.pop() !== "" || fields.length % 2) throw new Error("Invalid NUL-delimited git diff.");
  const paths = [];
  let typeChange = false;
  for (let index = 0; index < fields.length; index += 2) {
    if (!fields[index + 1]) throw new Error("Empty changed path.");
    paths.push(fields[index + 1]);
    if (!["A", "M", "D"].includes(fields[index])) typeChange = true;
  }
  return { ...(typeChange ? { profile: "full", reason: "A file type changed; use the full gate." } : classifyPaths(paths)), paths };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const scope = determineScope({ eventName: process.env.GITHUB_EVENT_NAME, event, sha: process.env.GITHUB_SHA });
  console.log(JSON.stringify(scope, null, 2));
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `profile=${scope.profile}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      "## Verification scope", `Profile: **${scope.profile}**. ${scope.reason}`,
      scope.profile === "full"
        ? "Product checks and deployment remain applicable (subject to the existing event/fork restrictions)."
        : "Document checks apply; tooling checks also apply for the tooling profile. Product tests, browser journeys, deployment and remote preview E2E are **not applicable and will not run**; this is not a claim that those tests passed.",
      "Changed paths (JSON escaped):", "```json", JSON.stringify(scope.paths, null, 2), "```", "",
    ].join("\n\n"));
  }
}
