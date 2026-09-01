import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const DEFAULT_CONFIG = new URL("../config/local-portal.env", import.meta.url);
const REQUIRED = [
  "EVENT_ID",
  "SESSION_SECRET",
  "HASH_PEPPER",
  "ADMIN_EMAILS",
  "PREVIEW_MAIL_SINK",
  "PREVIEW_TEST_RECIPIENTS",
  "PREVIEW_E2E_TOKEN",
  "TURNSTILE_SITEKEY",
  "TURNSTILE_SECRET",
  "THUMBNAIL_PUBLIC_ORIGIN",
  "ORGANIZER_PUBLICATION_MODE",
];

export async function readLocalPortalEnvironment(source = DEFAULT_CONFIG) {
  const text = await readFile(source, "utf8");
  const values = Object.fromEntries(text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      assert.ok(separator > 0, `invalid local portal env line: ${line}`);
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));

  for (const name of REQUIRED) assert.ok(values[name], `local portal env is missing ${name}`);
  assert.equal(values.EVENT_ID, "sample", "local portal must use fictional fixture data");
  assert.match(values.ADMIN_EMAILS, /^[^,\s]+\.test$/, "local portal admin must be one reserved .test address");
  assert.equal(values.PREVIEW_MAIL_SINK, "d1", "local portal mail must stay in D1");
  assert.equal(values.PREVIEW_TEST_RECIPIENTS, values.ADMIN_EMAILS);
  assert.equal(values.TURNSTILE_SITEKEY, "1x00000000000000000000AA");
  assert.equal(values.TURNSTILE_SECRET, "1x0000000000000000000000000000000AA");
  assert.equal(values.THUMBNAIL_PUBLIC_ORIGIN, "http://127.0.0.1:8788/__local-thumbnail");
  assert.equal(values.ORGANIZER_PUBLICATION_MODE, "disabled");
  assert.equal(values.MAILGUN_API_KEY, undefined, "local portal must not carry Mailgun credentials");
  assert.equal(values.MAILGUN_DOMAIN, undefined, "local portal must not carry a Mailgun domain");
  return values;
}

/** Explicit bindings override production-shaped vars already present in wrangler.jsonc. */
export function localPortalWranglerArgs(values) {
  return [
    "pages",
    "dev",
    "dist",
    "--ip",
    "127.0.0.1",
    "--port",
    "8788",
    "--persist-to",
    ".wrangler/local-portal",
    ...Object.entries(values).flatMap(([name, value]) => ["--binding", `${name}=${value}`]),
  ];
}
