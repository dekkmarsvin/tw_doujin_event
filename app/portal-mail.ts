export type MailEnvironment = Pick<PortalEnv, "MAILGUN_API_KEY" | "MAILGUN_DOMAIN" | "MAILGUN_SENDER" |
  "PREVIEW_MAIL_SINK" | "PREVIEW_TEST_RECIPIENTS" | "PREVIEW_SANDBOX_RECIPIENTS">;
/** `html`, when present, goes alongside `text`; the text part must stand on its own. */
export type PortalMail = {
  purpose: "login_link" | "organizer_invitation" | "review_digest";
  to: string; subject: string; text: string; html?: string;
};

export class MailDeliveryError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Only known transport failures can establish that mail was not accepted. */
export function mailFailure(error: unknown): { delivery: "failed" | "unknown"; code: string } {
  if (error instanceof MailDeliveryError) {
    if (/^mailgun_[45]\d\d$/.test(error.code) || error.code === "preview_recipient_denied") {
      return { delivery: "failed", code: error.code };
    }
    if (error.code === "Missing Mailgun configuration.") return { delivery: "failed", code: "mail_configuration" };
  }
  return { delivery: "unknown", code: error instanceof Error && error.name === "TimeoutError" ? "delivery_timeout" : "delivery_unknown" };
}

function addressList(value: string | undefined) {
  return new Set((value ?? "").split(/[,;\s]+/).map(entry => entry.normalize("NFKC").trim().toLowerCase()).filter(Boolean));
}

export function previewMailRouteFor(env: MailEnvironment, email: string): "sink" | "sandbox" | null {
  if (env.PREVIEW_MAIL_SINK !== "d1") return null;
  const address = email.normalize("NFKC").trim().toLowerCase();
  if (addressList(env.PREVIEW_TEST_RECIPIENTS).has(address)) return "sink";
  if (addressList(env.PREVIEW_SANDBOX_RECIPIENTS).has(address)) return "sandbox";
  return null;
}

async function sendMailgun(env: MailEnvironment, message: PortalMail, options: { logRejectionBody?: boolean } = {}) {
  const { MAILGUN_API_KEY: key, MAILGUN_DOMAIN: domain } = env;
  if (!key || !domain) throw new MailDeliveryError("Missing Mailgun configuration.");
  const form = new URLSearchParams({ from: env.MAILGUN_SENDER ?? `場刊 Map <noreply@${domain}>`,
    to: message.to, subject: message.subject, text: message.text });
  // Both parts go in one message; Mailgun builds the multipart/alternative.
  if (message.html) form.set("html", message.html);
  const response = await fetch(`https://api.mailgun.net/v3/${encodeURIComponent(domain)}/messages`, {
    method: "POST", headers: { authorization: `Basic ${btoa(`api:${key}`)}`, "content-type": "application/x-www-form-urlencoded" },
    body: form, signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    // Only the existing, explicitly allowlisted preview sandbox may expose the
    // rejection body. Notification logs always retain a status-only code.
    if (options.logRejectionBody) console.error(`Mailgun rejected the message (${response.status}). ${(await response.text()).slice(0, 300)}`);
    throw new MailDeliveryError(`mailgun_${response.status}`);
  }
  const body = await response.json().catch(() => null) as { id?: unknown } | null;
  return typeof body?.id === "string" ? body.id : "accepted";
}

export async function sendPortalMail(env: MailEnvironment, message: PortalMail,
  store: (message: PortalMail) => Promise<void>) {
  if (env.PREVIEW_MAIL_SINK === "d1") {
    const route = previewMailRouteFor(env, message.to);
    if (route === "sink") { await store(message); return "preview-sink"; }
    if (route !== "sandbox") throw new MailDeliveryError("preview_recipient_denied");
    return sendMailgun(env, message, { logRejectionBody: true });
  }
  return sendMailgun(env, message);
}
