// Verifies the doc -> code map that each contract declares in its header, and
// regenerates the reverse map at docs/contracts/INDEX.md.
//
// Contracts name what they govern in a `**實作**：` line (and `**測試**：` for
// the tests that hold them to it). Nothing pointed the other way, so an agent
// starting from a file it must change could not find the contract governing it
// without opening all twelve. This builds that direction and keeps it honest:
// a path a contract names but that no longer exists is an error, not a stale
// link someone notices later.
//
//   node scripts/check-doc-map.mjs          check, and rewrite the index
//   node scripts/check-doc-map.mjs --check  check only, no writes (for CI)
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTRACTS = "docs/contracts";
const INDEX = `${CONTRACTS}/INDEX.md`;

const exists = async (relative) => stat(path.join(ROOT, relative)).then(() => true, () => false);

/** Repo-relative paths from a `**key**：` header line, in link or code form. */
function pathsFrom(line) {
  const found = new Set();
  for (const [, target] of line.matchAll(/\]\((?:\.\.\/)+([^)]+)\)/g)) found.add(target);
  for (const [, target] of line.matchAll(/`((?:app|db|functions|scripts|worker|workers)\/[^`]+)`/g)) found.add(target);
  for (const [, target] of line.matchAll(/`(tests\/[\w.-]+\.test\.mjs)`/g)) found.add(target);
  return [...found];
}

async function readContracts() {
  const files = (await readdir(path.join(ROOT, CONTRACTS)))
    .filter((file) => file.endsWith(".md") && file !== "INDEX.md")
    .sort();
  const contracts = [];
  for (const file of files) {
    const source = await readFile(path.join(ROOT, CONTRACTS, file), "utf8");
    // Split on either ending: .gitattributes checks these files out as CRLF,
    // and a trailing CR would ride into every generated link label.
    const lines = source.split(/\r?\n/);
    const title = (lines.find((line) => line.startsWith("# ")) ?? file).replace(/^# /, "");
    const purpose = lines.slice(1, 12)
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("**") && !line.startsWith("#") && !line.startsWith(">")) ?? "";
    const implementation = [];
    const tests = [];
    for (const line of lines.slice(0, 20)) {
      if (/^\*\*(實作|schema 權威|寫入端|身分權威)\*\*/.test(line)) implementation.push(...pathsFrom(line));
      if (/^\*\*測試\*\*/.test(line)) tests.push(...pathsFrom(line));
    }
    const normalize = (target) => target.replace(/\/+$/, "");
    contracts.push({
      file, title, purpose,
      implementation: [...new Set(implementation.map(normalize))],
      tests: [...new Set(tests.map(normalize))],
    });
  }
  return contracts;
}

const contracts = await readContracts();
const problems = [];

for (const contract of contracts) {
  if (contract.implementation.length === 0) {
    problems.push(`${CONTRACTS}/${contract.file}: no **實作** header — nothing says which code this governs`);
  }
  for (const target of [...contract.implementation, ...contract.tests]) {
    if (!(await exists(target))) {
      problems.push(`${CONTRACTS}/${contract.file}: names ${target}, which does not exist`);
    }
  }
}

// Reverse: source file -> the contracts that claim it.
const owners = new Map();
for (const contract of contracts) {
  for (const target of contract.implementation) {
    if (!owners.has(target)) owners.set(target, []);
    owners.get(target).push(contract);
  }
}

function renderIndex() {
  const rows = [...owners.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([target, list]) => {
    const links = list.map((c) => `[${c.title.replace(/契約$/, "")}](./${c.file})`).join("、");
    const tests = [...new Set(list.flatMap((c) => c.tests))].map((t) => `\`${t}\``).join("、");
    return `| \`${target}\` | ${links} | ${tests || "—"} |`;
  });

  const body = `# 契約索引

從**要改的檔案**反查是哪一份契約在管它。契約描述現況且可驗收；實作與契約不一致時，兩者之一是錯的。

這份索引由 \`scripts/check-doc-map.mjs\` 從各契約開頭的 \`**實作**\` 與 \`**測試**\` 產生，不要手動編輯。新增契約或改動實作清單後重跑它。

## 依檔案

| 檔案 | 契約 | 測試 |
|---|---|---|
${rows.join("\n")}

## 依契約

| 契約 | 涵蓋 |
|---|---|
${contracts.map((c) => `| [${c.title}](./${c.file}) | ${c.purpose} |`).join("\n")}
`;
  return body;
}

const rendered = renderIndex();
if (process.argv.includes("--check")) {
  const onDisk = await readFile(path.join(ROOT, INDEX), "utf8").catch(() => null);
  // Compare ending-insensitively: .gitattributes checks these out as CRLF.
  const lf = (text) => text.split("\r\n").join("\n");
  const same = onDisk !== null && lf(onDisk) === lf(rendered);
  if (!same) {
    problems.push(`${INDEX} is stale — run \`node scripts/check-doc-map.mjs\` and commit the result`);
  }
} else {
  await writeFile(path.join(ROOT, INDEX), rendered, "utf8");
  console.log(`wrote ${INDEX}: ${owners.size} files across ${contracts.length} contracts`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`${contracts.length} contracts check out.`);
