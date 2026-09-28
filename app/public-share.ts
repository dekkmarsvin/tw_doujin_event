/** A cancelled share sheet is a choice; an unavailable one falls back to copy. */
export async function sharePublicContent(data: { title: string; text?: string; url: string }): Promise<"shared" | "copied" | "manual" | "cancelled"> {
  if (typeof navigator.share === "function") {
    try { await navigator.share(data); return "shared"; }
    catch (error) { if (error instanceof DOMException && error.name === "AbortError") return "cancelled"; }
  }
  try {
    await navigator.clipboard.writeText([data.text, data.url].filter(Boolean).join("\n"));
    return "copied";
  } catch { return "manual"; }
}
