import { preparePreviewFixture, cleanupPreviewFixture } from "./preview-e2e-resources.mjs";
import { previewRequestInit } from "./preview-transport.mjs";

const baseUrl = process.env.PREVIEW_BASE_URL?.replace(/\/$/, "");
const e2eToken = process.env.PREVIEW_E2E_TOKEN;
if (!baseUrl || !e2eToken) throw new Error("PREVIEW_BASE_URL and PREVIEW_E2E_TOKEN are required.");

// Preview hosts sit behind Cloudflare Access with no Bypass path (ADR-0011).
// A non-browser client authenticates with a service token instead; without it
// every call below is answered by the Access login redirect, not the portal.
const accessHeaders = process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
  ? { "cf-access-client-id": process.env.CF_ACCESS_CLIENT_ID, "cf-access-client-secret": process.env.CF_ACCESS_CLIENT_SECRET }
  : {};

function rejectAccessLogin(response, label) {
  if (!(response.headers.get("location") ?? "").includes("cloudflareaccess.com")) return;
  throw new Error(`${label} was intercepted by Cloudflare Access (${response.status}). CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must name a service token that a Service Auth policy admits on *.tw-catalog.pages.dev.`);
}

async function request(path, { method = "GET", body, cookie, previewToken = false } = {}) {
  const response = await fetch(`${baseUrl}${path}`, previewRequestInit(baseUrl, {
    method, body, cookie, accessHeaders, e2eToken: previewToken ? e2eToken : undefined,
  }));
  rejectAccessLogin(response, `${method} ${path}`);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("json") ? await response.json() : null;
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}${payload?.error ? `: ${payload.error}` : ""}.`);
  return { response, payload };
}

async function capturedLoginToken(email) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/preview/mail?email=${encodeURIComponent(email)}`,
      previewRequestInit(baseUrl, { accessHeaders, e2eToken }));
    rejectAccessLogin(response, `GET /api/preview/mail for ${email}`);
    if (response.ok) {
      const { message } = await response.json();
      const match = message?.text?.match(/login=([^\s]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Preview mail sink did not capture a login link for ${email}.`);
}

async function signIn(email) {
  // Preview runs Turnstile on Cloudflare's always-passes dummy secret (see
  // `wrangler.jsonc`), which accepts any non-empty token. This driver is not a
  // browser and could not solve a real widget; if preview is ever pointed at a
  // live key, this call starts failing with 403 rather than silently skipping
  // the check.
  await request("/api/auth/request-link", { method: "POST", body: { email, turnstileToken: "preview-dummy-token" } });
  const token = await capturedLoginToken(email);
  const { response } = await request("/api/auth/verify", { method: "POST", body: { token } });
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  if (!cookie.includes("=")) throw new Error(`Verify did not return a session cookie for ${email}.`);
  return cookie;
}

/**
 * Signing in proves the mailbox, not the role. Without this the flow reaches
 * `POST /api/admin/claims` and fails there with a bare `沒有權限。`, which reads
 * like a bug in claim approval rather than a roster that never contained this
 * address. The fixture endpoint must provision this run before sign-in.
 */
async function requireAdmin(cookie, email) {
  const { payload } = await request("/api/auth/session", { cookie });
  if (payload?.isAdmin) return;
  throw new Error([
    `${email} signed in but is not on the preview admin roster, so approval cannot be exercised.`,
    "POST /api/preview/mail must provision the reserved run identity before sign-in.",
    "Inspect it with: npx wrangler d1 execute tw-catalog-identity-preview --remote --command 'SELECT email, added_by FROM admins'",
  ].join("\n  "));
}

const fixture = await preparePreviewFixture({ baseUrl, deploymentId: process.env.PREVIEW_DEPLOYMENT_ID, sha: process.env.GITHUB_SHA });
const { adminEmail, circleEmail } = fixture;
try {
  await request("/api/preview/mail", { method: "POST", previewToken: true, body: { runId: fixture.runId } });
  console.log(`Preview D1 and both R2 bindings proved for ${fixture.runId}.`);
  const adminCookie = await signIn(adminEmail);
  await requireAdmin(adminCookie, adminEmail);
  const circleCookie = await signIn(circleEmail);
  const { payload: search } = await request(`/api/circle/search?q=${encodeURIComponent("33号")}`, { cookie: circleCookie });
  const circle = search.circles?.[0];
  if (!circle?.id) throw new Error("Preview catalog search returned no circle fixture.");
  const { payload: existingOverlay } = await request(`/data/events/ff47/overrides.json?e2e=${fixture.runId}`);
  if (existingOverlay.overrides?.some(item => item.circleId === circle.id)) {
    throw new Error("The preview circle already has content; preserve it and choose an unused fixture.");
  }

  const { payload: claim } = await request("/api/claims", { method: "POST", cookie: circleCookie, body: { circleId: circle.id, evidenceNote: "preview E2E" } });
  await request("/api/admin/claims", { method: "POST", cookie: adminCookie, body: { claimId: claim.id, decision: "approve" } });

  const marker = `preview-e2e-${Date.now()}`;
  const fields = { saleInfo: marker };
  const { payload: preview } = await request(`/api/circle/${encodeURIComponent(circle.id)}/preview`, { method: "POST", cookie: circleCookie, body: { fields } });
  if (!Array.isArray(preview.records)) throw new Error("Circle preview did not return projected records.");
  await request(`/api/circle/${encodeURIComponent(circle.id)}/overrides`, { method: "PUT", cookie: circleCookie, body: { fields } });

  const { payload: published } = await request(`/data/events/ff47/overrides.json?e2e=${encodeURIComponent(marker)}`);
  const entry = published.overrides?.find((item) => item.circleId === circle.id);
  if (entry?.fields?.saleInfo !== marker) throw new Error("Public overlay did not contain the preview E2E edit.");
  console.log(`Preview portal E2E passed for one isolated circle (${circle.id}).`);
} finally {
  await cleanupPreviewFixture();
}
