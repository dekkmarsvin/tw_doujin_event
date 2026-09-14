import { PublicationFailure } from "./organizer-publication";

/** The token is refreshed before GitHub's one-hour expiry, not at expiry. */
export const GITHUB_TOKEN_REFRESH_WINDOW_MS = 60_000;
export const GITHUB_APP_JWT_LIFETIME_SECONDS = 600;
export const GITHUB_APP_JWT_CLOCK_SKEW_SECONDS = 60;

export type GitHubTokenProvider = {
  getToken: () => Promise<string>;
  invalidate: (rejectedToken: string) => void;
};

export type GitHubAppTokenProviderOptions = {
  appId: string;
  installationId: string;
  privateKey: string;
  /** Optional request-scoped restriction used by the installation probe. */
  repositories?: readonly string[];
  permissions?: Readonly<Record<string, "read" | "write">>;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
};

const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_USER_AGENT = "tw-doujin-event-publication/1";
const JWT_ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

function configurationFailure() {
  return new PublicationFailure("github_app_config", "GitHub App authentication is not configured.", false);
}

function keyFailure() {
  return new PublicationFailure("github_app_key", "GitHub App private key is invalid.", false);
}

function tokenResponseFailure(retryable = true) {
  return new PublicationFailure("github_app_token", "GitHub App token response is invalid.", retryable);
}

function tokenRequestFailure(retryable: boolean) {
  return new PublicationFailure("github_app_request", "GitHub App token request failed.", retryable);
}

function derLength(length: number) {
  if (!Number.isSafeInteger(length) || length < 0) throw keyFailure();
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function concatenate(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

/** Wrap a PKCS#1 RSA private key in the PKCS#8 PrivateKeyInfo envelope. */
function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const algorithm = Uint8Array.of(
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  );
  const privateKey = concatenate(Uint8Array.of(0x04), derLength(pkcs1.byteLength), pkcs1);
  const body = concatenate(version, algorithm, privateKey);
  return concatenate(Uint8Array.of(0x30), derLength(body.byteLength), body);
}

function decodePem(privateKey: string): ArrayBuffer {
  if (typeof privateKey !== "string") throw keyFailure();
  const source = privateKey.trim();
  const pem = /^-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (RSA )?PRIVATE KEY-----$/u.exec(source);
  if (!pem || pem[1] !== pem[3]) throw keyFailure();
  const encoded = pem[2].replace(/\s+/gu, "");
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded) || encoded.length % 4 === 1) throw keyFailure();
  let binary: string;
  try { binary = atob(encoded); } catch { throw keyFailure(); }
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (decoded.byteLength === 0) throw keyFailure();
  const der = pem[1] ? pkcs1ToPkcs8(decoded) : decoded;
  return der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength);
}

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function encodedJson(value: unknown) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function safeNow(now: () => number) {
  let value: number;
  try { value = now(); } catch { throw configurationFailure(); }
  if (!Number.isFinite(value)) throw configurationFailure();
  return value;
}

function validAppId(value: unknown) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

function validInstallationId(value: unknown) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function validExpiry(value: unknown, now: number) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > now ? parsed : null;
}

function mintScope(options: GitHubAppTokenProviderOptions) {
  if (options.repositories === undefined && options.permissions === undefined) return undefined;
  const scope: { repositories?: string[]; permissions?: Record<string, unknown> } = {};
  if (options.repositories !== undefined) {
    if (!Array.isArray(options.repositories) || options.repositories.length === 0
      || options.repositories.some((repository) => typeof repository !== "string" || !repository.trim() || repository.trim() !== repository)) {
      throw configurationFailure();
    }
    scope.repositories = [...options.repositories];
  }
  if (options.permissions !== undefined) {
    if (!options.permissions || typeof options.permissions !== "object" || Array.isArray(options.permissions)) {
      throw configurationFailure();
    }
    const permissions = options.permissions as Record<string, unknown>;
    const permissionNames = Object.keys(permissions);
    if (permissionNames.length === 0 || permissionNames.some((name) => {
      const value = permissions[name];
      return typeof value !== "string" || (value !== "read" && value !== "write");
    })) throw configurationFailure();
    scope.permissions = { ...permissions };
  }
  return scope;
}

type CachedToken = { token: string; expiresAt: number };

/**
 * Signs an App JWT and exchanges it for an installation token. State is kept
 * in this closure so each provider/job gets one cache and one mint in flight.
 */
export function createGitHubAppTokenProvider(options: GitHubAppTokenProviderOptions): GitHubTokenProvider {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  let cached: CachedToken | null = null;
  let pending: Promise<string> | null = null;

  async function mint() {
    if (!validAppId(options.appId) || !validInstallationId(options.installationId) || !options.privateKey) {
      throw configurationFailure();
    }
    const scope = mintScope(options);
    const current = safeNow(now);
    let keyBytes: ArrayBuffer;
    try { keyBytes = decodePem(options.privateKey); } catch (error) {
      if (error instanceof PublicationFailure) throw error;
      throw keyFailure();
    }

    let jwt: string;
    try {
      const key = await crypto.subtle.importKey("pkcs8", keyBytes, JWT_ALGORITHM, false, ["sign"]);
      const iat = Math.floor(current / 1000) - GITHUB_APP_JWT_CLOCK_SKEW_SECONDS;
      const exp = iat + GITHUB_APP_JWT_LIFETIME_SECONDS;
      const header = encodedJson({ alg: "RS256", typ: "JWT" });
      const claims = encodedJson({ iat, exp, iss: options.appId });
      const signingInput = `${header}.${claims}`;
      const signature = await crypto.subtle.sign(JWT_ALGORITHM, key, new TextEncoder().encode(signingInput));
      jwt = `${signingInput}.${base64Url(signature)}`;
    } catch {
      throw keyFailure();
    }

    let response: Response;
    try {
      response = await requestFetch(`${GITHUB_API_ORIGIN}/app/installations/${encodeURIComponent(options.installationId)}/access_tokens`, {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
          "user-agent": GITHUB_USER_AGENT,
          "x-github-api-version": GITHUB_API_VERSION,
        },
        ...(scope ? { body: JSON.stringify(scope) } : {}),
      });
    } catch {
      throw tokenRequestFailure(true);
    }
    if (response.status !== 201) throw tokenRequestFailure(response.status === 429 || response.status >= 500);

    let body: unknown;
    try { body = await response.json(); } catch { throw tokenResponseFailure(true); }
    if (!body || typeof body !== "object") throw tokenResponseFailure(false);
    const token = (body as { token?: unknown }).token;
    const expiresAt = validExpiry((body as { expires_at?: unknown }).expires_at, current);
    if (!validToken(token) || expiresAt === null) throw tokenResponseFailure(false);
    return { token, expiresAt };
  }

  async function getToken() {
    const current = safeNow(now);
    if (cached && validToken(cached.token) && cached.expiresAt > current + GITHUB_TOKEN_REFRESH_WINDOW_MS) {
      return cached.token;
    }
    if (pending) return pending;
    const work = mint().then(({ token, expiresAt }) => {
      cached = { token, expiresAt };
      return token;
    }).finally(() => {
      if (pending === work) pending = null;
    });
    pending = work;
    return work;
  }

  function invalidate(rejectedToken: string) {
    if (cached?.token === rejectedToken) cached = null;
  }

  return { getToken, invalidate };
}
