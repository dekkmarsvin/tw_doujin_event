import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deriveTiers, listTestFiles, readDeclaredDeps, TIER_NAMES, tierMembers } from "../scripts/select-tests.mjs";

const read = (name) => readFile(new URL(`../tests/${name}`, import.meta.url), "utf8");

test("every test file on disk lands in exactly one tier", async () => {
  const onDisk = await listTestFiles();
  const members = tierMembers(await deriveTiers());
  assert.deepEqual([...members].sort(), onDisk, "a test file in no tier would run nowhere, CI included");
  assert.equal(new Set(members).size, members.length, "a test file in two tiers would run twice");
});

test("a tier's members actually pay that tier's cost", async () => {
  const tiers = await deriveTiers();
  for (const name of TIER_NAMES) {
    for (const file of tiers[name]) {
      const source = await read(file);
      const readsDist = /new URL\(\s*[`"']\.\.\/dist/.test(source);
      const bootsMiniflare = /(?:from|import)\s*\(?\s*["']miniflare["']/.test(source);
      const forks = /(?:from|import)\s*\(?\s*["']node:child_process["']/.test(source);
      const expected = readsDist ? "artifact" : bootsMiniflare ? "d1" : forks ? "cli" : "module";
      assert.equal(name, expected, `${file} is in ${name} but its source says ${expected}`);
    }
  }
});

test("the module tier needs neither a build, a D1 nor a subprocess", async () => {
  const { module: members } = await deriveTiers();
  assert.ok(members.length > 0);
  for (const file of members) {
    const source = await read(file);
    assert.doesNotMatch(source, /new URL\(\s*[`"']\.\.\/dist/, `${file} reads dist/ and needs npm run build`);
    assert.doesNotMatch(source, /(?:from|import)\s*\(?\s*["']miniflare["']/, `${file} boots Miniflare`);
    assert.doesNotMatch(source, /(?:from|import)\s*\(?\s*["']node:child_process["']/, `${file} forks a subprocess`);
  }
});

test("declared edges name real test files", async () => {
  const declared = await readDeclaredDeps();
  const onDisk = await listTestFiles();
  assert.ok(Object.keys(declared).length > 0);
  for (const file of Object.keys(declared)) {
    assert.ok(onDisk.includes(file), `tests/test-deps.json declares edges for ${file}, which does not exist`);
  }
});
