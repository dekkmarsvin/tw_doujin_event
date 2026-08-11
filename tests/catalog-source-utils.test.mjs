import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { normalizeTextSource } from "../scripts/catalog-source-utils.mjs";

const sha256 = (value) => createHash("sha256").update(normalizeTextSource(value)).digest("hex");

test("catalog text source hashes are stable across platform line endings", () => {
  const lf = "circle_name,thumbnail_url\n社團甲,https://example.com/a.png\n";
  const crlf = lf.replaceAll("\n", "\r\n");
  const cr = lf.replaceAll("\n", "\r");

  assert.equal(normalizeTextSource(crlf), lf);
  assert.equal(normalizeTextSource(cr), lf);
  assert.equal(sha256(crlf), sha256(lf));
  assert.equal(sha256(cr), sha256(lf));
});
