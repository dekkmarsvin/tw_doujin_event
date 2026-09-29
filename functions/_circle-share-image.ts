import type { CircleShareImage } from "../app/circle-share-image";
import { publicCircleShareImage } from "./_portal";

/** Restrict the dynamic projection to successful circle HTML responses.
 * A query string cannot supply an image or bypass public visibility. */
export async function applyCircleShareImage(context: { request: Request; env: PortalEnv }, response: Response): Promise<Response> {
  const match = new URL(context.request.url).pathname.match(/^\/events\/([a-z0-9][a-z0-9-]*)\/circles\/([a-zA-Z0-9-]+)\/(?:index\.html)?$/);
  if (!match || context.request.method !== "GET" || response.status !== 200
    || !(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) return response;
  let image: CircleShareImage | null;
  try { image = await publicCircleShareImage(context, match[1], match[2]); }
  catch {
    // Optional media must not take down the official circle page. The static
    // brand image is also the safe fallback for unavailable identity data.
    console.warn("Circle share image unavailable", { eventId: match[1], circleId: match[2] });
    return response;
  }
  if (!image) return response;
  return rewriteCircleShareImage(response, image);
}

export function rewriteCircleShareImage(response: Response, image: CircleShareImage): Response {
  return new HTMLRewriter()
    .on('meta[property="og:image"]', { element(element) { element.setAttribute("content", image.url); } })
    .on('meta[property="og:image:width"]', { element(element) {
      if (image.width) element.setAttribute("content", String(image.width)); else element.remove();
    } })
    .on('meta[property="og:image:height"]', { element(element) {
      if (image.height) element.setAttribute("content", String(image.height)); else element.remove();
    } })
    .transform(response);
}
