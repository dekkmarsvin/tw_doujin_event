/** 一個動作的回饋，放在發動它的控制項旁。
 *
 * 工作區原本只有一條通知，住在區段切換器之上：按鈕在 y=630，結果出現在
 * y=112，中間隔著整張表單；而且它不隨動作或區段切換清除，所以「已儲存。」
 * 會和「尚有未儲存變更」同時在畫面上，各自描述不同時刻（#220）。
 *
 * 把回饋交給發動動作的那個元件之後，兩件事都自然成立：訊息與按鈕同在一個
 * 視線範圍內，而切換區段時元件卸載，前一則訊息跟著消失——不需要另外寫清除
 * 邏輯，也就沒有忘記清除的地方。規則見 `docs/design/components.md` 的
 * Action Feedback。
 */
import { useCallback, useState } from "react";
import { PortalError } from "../circle-editor-client";
import { IDLE, message, type Notice } from "./organizer-shared";
import styles from "./organizer.module.css";

export type ActionFeedback = {
  notice: Notice;
  /** True while this action is in flight; other controls stay usable. */
  pending: boolean;
  /** Runs one action and reports it here. Starting replaces whatever the
   * previous action left, which is what keeps two states off the screen. */
  run: <T>(work: Promise<T>, success: string | ((value: T) => string)) => Promise<boolean>;
  clear: () => void;
  /** For a refusal this control knows about before any request is made. */
  fail: (reason: string) => void;
  /** For work this control ran without going through `run`. */
  succeed: (text: string) => void;
};

export function useActionFeedback(onUnauthorized?: () => void): ActionFeedback {
  const [notice, setNotice] = useState<Notice>(IDLE);
  const [pending, setPending] = useState(false);
  const run = useCallback(async <T,>(work: Promise<T>, success: string | ((value: T) => string)) => {
    setPending(true);
    setNotice({ kind: "busy", message: "處理中…" });
    try {
      const value = await work;
      setNotice({ kind: "ok", message: typeof success === "function" ? success(value) : success });
      return true;
    } catch (error) {
      if (error instanceof PortalError && error.status === 401) onUnauthorized?.();
      setNotice({ kind: "error", message: message(error) });
      return false;
    } finally {
      setPending(false);
    }
  }, [onUnauthorized]);
  const clear = useCallback(() => setNotice(IDLE), []);
  const fail = useCallback((reason: string) => setNotice({ kind: "error", message: reason }), []);
  const succeed = useCallback((text: string) => setNotice({ kind: "ok", message: text }), []);
  return { notice, pending, run, clear, fail, succeed };
}

/** Renders beside the control that owns it. `role="status"` so a reader who
 * cannot see the button and the line together still hears the result. */
export function ActionNotice({ notice }: { notice: Notice }) {
  if (notice.kind === "idle") return null;
  return <p role="status" className={notice.kind === "error" ? styles.error : styles.notice}>{notice.message}</p>;
}
