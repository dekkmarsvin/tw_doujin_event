import { previewE2eAuthorized, previewSinkRecipientAllowed, repositoryFor } from "../../_portal";
import { deleteObjectKeys } from "../../../app/hosted-thumbnails";

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
  const repository = repositoryFor(env);
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.THUMBNAILS.list({ ...(cursor ? { cursor } : {}) });
    keys.push(...page.objects.map(({ key }) => key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await deleteObjectKeys(env.THUMBNAILS, keys);
  await repository.clearPreviewData();
  return json({ ok: true });
};
