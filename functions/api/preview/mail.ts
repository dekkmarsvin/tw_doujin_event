import { previewE2eAuthorized, previewSinkRecipientAllowed, repositoryFor } from "../../_portal";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

/** Preview-only mail sink reader. Production has neither the flag nor token. */
export const onRequestGet: PagesFunction<PortalEnv> = async ({ request, env }) => {
  if (!previewE2eAuthorized(env, request)) return json({ error: "not found" }, 404);
  const email = new URL(request.url).searchParams.get("email")?.normalize("NFKC").trim().toLowerCase() ?? "";
  if (!previewSinkRecipientAllowed(env, email)) return json({ error: "recipient is not allowlisted" }, 403);
  const message = await repositoryFor(env).latestPreviewMail(email);
  return message ? json({ message }) : json({ error: "message not found" }, 404);
};

/** Clear disposable accounts, claims, overrides, audit and captured mail. */
export const onRequestDelete: PagesFunction<PortalEnv> = async ({ request, env }) => {
  if (!previewE2eAuthorized(env, request)) return json({ error: "not found" }, 404);
  await repositoryFor(env).clearPreviewData();
  return json({ ok: true });
};
