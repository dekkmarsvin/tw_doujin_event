/**
 * Prototype Worker: upload a floor plan, get a draft booth map back.
 *
 * Stateless by design. It binds no storage, keeps nothing after the response
 * and calls no other service, so its whole cost is one Worker request and the
 * CPU of decoding and recognising the image (a few hundred milliseconds for a
 * typical plan). Not deployed: see this directory's README before exposing it.
 */
import { UnsupportedImageError } from "./decode-image";
import { parseCrop, recognizePlan } from "./pipeline";
import { PAGE } from "./page";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(PAGE, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
          "cache-control": "no-store",
        },
      });
    }
    if (url.pathname !== "/recognize") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return json({ error: "請用 POST 上傳配置圖。" }, 405);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_UPLOAD_BYTES) return json({ error: "檔案太大，請上傳 12 MB 以內的配置圖。" }, 413);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "無法讀取上傳內容。" }, 400);
    }
    const file = form.get("image");
    if (!file || typeof file === "string") return json({ error: "請選擇配置圖。" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return json({ error: "檔案太大，請上傳 12 MB 以內的配置圖。" }, 413);
    const boothList = String(form.get("boothList") ?? "");
    const crop = parseCrop(String(form.get("crop") ?? ""));
    const template = String(form.get("template") ?? "").slice(0, 64);
    try {
      const result = await recognizePlan(new Uint8Array(await file.arrayBuffer()), { boothList, crop, template });
      return json({ sourceName: file.name, ...result });
    } catch (error) {
      if (error instanceof UnsupportedImageError) return json({ error: error.message }, 422);
      console.error(JSON.stringify({ event: "recognize.failed", message: error instanceof Error ? error.message : String(error) }));
      return json({ error: "辨識失敗，請換一張配置圖再試。" }, 500);
    }
  },
};
