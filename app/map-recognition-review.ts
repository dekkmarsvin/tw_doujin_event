import type { EventMapLayout } from "./event-map";
import type { LayoutReport } from "./map-auto-recognition/build-layout";
import { adoptRecognitionDraft, recognitionChoiceKey, type RecognitionChoice } from "./map-recognition-draft";

/** Session-local progress, never part of the saved map or undo history. Proposal
 * indices stay fixed even as successive batches are added to the current map. */
export type RecognitionPreview = { base: EventMapLayout; report: LayoutReport; adopted: string[] };

export function adoptRecognitionPreview(current: EventMapLayout, preview: RecognitionPreview, choices: readonly RecognitionChoice[]):
  { ok: true; layout: EventMapLayout; preview: RecognitionPreview } | { ok: false; errors: string[] } {
  if (preview.base !== current) return { ok: false, errors: ["地圖已變更，請重新辨識。"] };
  const keys = choices.map(recognitionChoiceKey);
  if (keys.some(key => preview.adopted.includes(key))) return { ok: false, errors: ["已採用的項目不能重複加入。"] };
  const result = adoptRecognitionDraft(current, preview.report.layout, choices);
  if (!result.ok) return result;
  return { ...result, preview: { ...preview, base: result.layout, adopted: [...new Set([...preview.adopted, ...keys])] } };
}

/** Copy belongs to this review surface. Compare exact codes, not row names or
 * warning prose; a partially drawn row still needs its remaining booths. */
export function recognitionWarnings(report: LayoutReport, current: EventMapLayout): string[] {
  const drawn = new Set(current.rows.flatMap(row => row.slots.map(slot => slot.code)));
  return report.diagnostics.flatMap(diagnostic => {
    if (diagnostic.kind === "notice") return [diagnostic.message];
    const missing = diagnostic.codes.filter(code => !drawn.has(code));
    if (!missing.length) return [];
    return [diagnostic.kind === "missing-row"
      ? `${diagnostic.label} 排尚缺 ${missing.join("、")}，請手動新增。`
      : `${diagnostic.label} 排尚缺 ${missing.length} 格：${missing.join("、")}，請補上。`];
  });
}
