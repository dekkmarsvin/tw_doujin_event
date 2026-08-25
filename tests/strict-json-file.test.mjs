import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonBytesStrict } from "../scripts/strict-json-file.mjs";

test("production JSON parsing rejects malformed UTF-8 even inside a valid JSON string", () => {
  const prefix = Buffer.from('{"name":"');
  const suffix = Buffer.from('"}');
  const malformed = Buffer.concat([prefix, Buffer.from([0xc3, 0x28]), suffix]);
  assert.throws(() => parseJsonBytesStrict(malformed, "event.json"), /not valid UTF-8 JSON/);
});

test("production JSON parsing accepts valid UTF-8 JSON", () => {
  assert.deepEqual(parseJsonBytesStrict(Buffer.from('{"name":"範例"}')), { name: "範例" });
});
