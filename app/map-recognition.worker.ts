import { recognizeEditorDraft, type RecognitionInput } from "./map-auto-recognition/editor";

self.onmessage = (event: MessageEvent<RecognitionInput>) => {
  try {
    self.postMessage({ report: recognizeEditorDraft(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "辨識失敗，請重新選取範圍。" });
  }
};

