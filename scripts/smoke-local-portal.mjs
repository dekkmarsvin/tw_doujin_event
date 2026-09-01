import assert from "node:assert/strict";
import { readLocalPortalEnvironment } from "./local-portal-environment.mjs";

const baseUrl = new URL(process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:8788");
const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
if (baseUrl.protocol !== "http:" || !localHosts.has(baseUrl.hostname)) {
  throw new Error("The local portal helper refuses non-loopback or HTTPS targets.");
}
baseUrl.pathname = "/";
baseUrl.search = "";
baseUrl.hash = "";

const config = await readLocalPortalEnvironment();
const adminEmail = config.ADMIN_EMAILS;
const previewToken = config.PREVIEW_E2E_TOKEN;
const smoke = process.argv.includes("--smoke");
assert.ok(adminEmail?.endsWith(".test"), "local portal admin must use a reserved .test address");
assert.ok(previewToken, "local portal mail token is missing");

function url(path) {
  return new URL(path.replace(/^\//, ""), baseUrl).toString();
}

async function request(path, { method = "GET", body, cookie, preview = false, expected = 200 } = {}) {
  const response = await fetch(url(path), {
    method,
    redirect: "manual",
    headers: {
      accept: "application/json",
      ...(method === "GET" || method === "HEAD"
        ? {}
        : { origin: baseUrl.origin, "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(preview ? { "x-preview-e2e-token": previewToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  assert.match(contentType, /application\/json/, `${method} ${path} must return JSON, not an HTML fallback`);
  const payload = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${payload.error ?? response.statusText}`);
  return { response, payload };
}

async function capturedLoginLink() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(url(`/api/preview/mail?email=${encodeURIComponent(adminEmail)}`), {
      headers: { accept: "application/json", "x-preview-e2e-token": previewToken },
    });
    if (response.ok) {
      const { message } = await response.json();
      const match = message?.text?.match(/https?:\/\/[^\s]+/);
      if (match) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The local D1 mail sink did not capture a login link.");
}

async function clearLocalData() {
  await request("/api/preview/mail", { method: "DELETE", preview: true });
}

async function issueLoginLink() {
  await request("/api/auth/request-link", {
    method: "POST",
    body: { email: adminEmail, turnstileToken: "local-dummy-token", audience: "organizer" },
    expected: 202,
  });
  return capturedLoginLink();
}

if (!smoke) {
  const loginLink = await issueLoginLink();
  console.log("Open this one-time local Organizer link in the browser:");
  console.log(loginLink);
} else {
  await clearLocalData();
  try {
    const { payload: authConfig } = await request("/api/auth/config");
    assert.equal(authConfig.turnstileSitekey, config.TURNSTILE_SITEKEY);
    await request("/api/auth/session", { expected: 401 });

    const loginLink = new URL(await issueLoginLink());
    const loginToken = loginLink.searchParams.get("login");
    assert.ok(loginToken, "captured Organizer mail has no login token");
    const { response: verifyResponse } = await request("/api/auth/verify", {
      method: "POST",
      body: { token: loginToken },
    });
    const cookie = (verifyResponse.headers.get("set-cookie") ?? "").split(";")[0];
    assert.match(cookie, /=/, "login verification did not return a session cookie");

    const { payload: session } = await request("/api/auth/session", { cookie });
    assert.equal(session.email, adminEmail);
    assert.equal(session.isAdmin, true);
    await request("/api/organizer/events", { cookie });
    console.log("Local portal smoke passed: auth config, mail sink, session, and Organizer API are usable.");
  } finally {
    await clearLocalData();
  }
}
