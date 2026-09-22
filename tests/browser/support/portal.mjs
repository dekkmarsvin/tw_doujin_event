// Signing in, for the journeys that need a signed-in portal.
//
// The magic link is fetched the way `scripts/smoke-local-portal.mjs` does it —
// out of the local D1 mail sink — because there is no other way to get one and
// no reason to invent a second: the link the journey opens is the link the
// mailer produced, and opening it exercises the real verification rather than
// a session cookie forged around it.
//
// Nothing here weakens a boundary. Turnstile is Cloudflare's own always-pass
// test key, the addresses are reserved `.test` ones, and the sink only answers
// with the preview token the local config carries. The security properties this
// cannot stand in for — enumeration resistance, the order Turnstile and CSRF
// are checked in, rejected requests not reaching the database, claim ownership
// races — stay in `tests/circle-portal-route.test.mjs`, where they belong.
import { readLocalPortalEnvironment } from "../../../scripts/local-portal-environment.mjs";
import { base } from "./journey.mjs";

const config = await readLocalPortalEnvironment();
export const ADMIN = config.ADMIN_EMAILS;
export const CIRCLE = config.PREVIEW_TEST_RECIPIENTS.split(/[,;\s]+/).filter(Boolean).find((address) => address !== ADMIN);

async function api(path, { method = "GET", body, preview = false } = {}) {
  return fetch(new URL(path, base), {
    method,
    headers: {
      accept: "application/json",
      // The portal refuses a cross-origin write, so a caller that cannot say
      // where it came from is correctly turned away.
      ...(method === "GET" ? {} : { origin: new URL(base).origin, "content-type": "application/json" }),
      ...(preview ? { "x-preview-e2e-token": config.PREVIEW_E2E_TOKEN } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The one-time link the mailer just produced for this address. */
export async function loginLink(email, audience, { event, circleId } = {}) {
  const requested = await api(`/api/auth/request-link${event ? `?event=${encodeURIComponent(event)}` : ""}`, {
    method: "POST",
    body: { email, turnstileToken: "local-dummy-token", audience, circleId },
  });
  if (requested.status !== 202) throw new Error(`request-link answered ${requested.status}: ${await requested.text()}`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const captured = await api(`/api/preview/mail?email=${encodeURIComponent(email)}`, { preview: true });
    if (captured.ok) {
      const link = (await captured.json()).message?.text?.match(/https?:\/\/[^\s]+/);
      if (link) return link[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`the local D1 mail sink captured no login link for ${email}`);
}

/** Open a page already signed in as `email`, by following its real link. */
export async function signIn(journey, email, audience, options = {}) {
  const link = await loginLink(email, audience);
  const page = await journey.page({ ...options, url: link });
  await page.getByRole("button", { name: "登出", exact: true }).waitFor();
  return page;
}

/** Clear captured mail so one journey's link can never be read by the next. */
export const clearMail = () => api("/api/preview/mail", { method: "DELETE", preview: true });
