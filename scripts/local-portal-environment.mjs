import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const DEFAULT_CONFIG = new URL("../config/local-portal.env", import.meta.url);
const RESERVED_TEST_ADDRESS = /^[^,\s]+\.test$/;
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
  assert.match(values.ADMIN_EMAILS, RESERVED_TEST_ADDRESS, "local portal admin must be one reserved .test address");
  assert.equal(values.PREVIEW_MAIL_SINK, "d1", "local portal mail must stay in D1");
  // Preview already has this shape: one admin, a longer deliverable list. Local
  // held the two lists identical, which made every address that could receive a
  // link an admin, so the flows needing a circle and an admin at once — claim
  // review, organizer invitation — had nobody to be the other party. Split them
  // the same way. The boundary that matters is unchanged: every address stays a
  // reserved `.test` one, and the admin has to be on the list or it could not
  // receive its own link.
  const recipients = values.PREVIEW_TEST_RECIPIENTS.split(/[,;\s]+/).filter(Boolean);
  for (const address of recipients) {
    assert.match(address, RESERVED_TEST_ADDRESS, "local portal mail recipients must be reserved .test addresses");
  }
  assert.ok(recipients.includes(values.ADMIN_EMAILS), "the local portal admin must be able to receive its own login link");
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
