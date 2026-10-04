import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PortalError, readTurnstileSitekey, requestLoginLink } from "./circle-editor-client";
import { TurnstileWidget } from "./circle-portal/turnstile-widget";
import { WorkspaceEntries, type Workspace } from "./workspace-nav";
import styles from "./portal-sign-in.module.css";

/**
 * The signed-out screen of both workspaces. `/circle` and `/organizer` are
 * reached from the same public "登入" and name each other above the form, so
 * they share one screen rather than each keeping a look of its own. Its
 * stylesheet names every rule it needs: neither workspace's page styles reach
 * it, and the organizer's invitation card can host the form alone.
 */
export function SignInScreen({ title, current, notice, circleId, children }: {
  title: string;
  current: Workspace;
  /** The workspace's own result, such as an expired session or a spent link. */
  notice?: { kind: "ok" | "error"; message: string } | null;
  /** A claim link names the circle, so the emailed link can bring it back there. */
  circleId?: string;
  /** Further fine print under the form. */
  children?: ReactNode;
}) {
  return <div className={styles.screen}>
    <header className={styles.head}>
      <h1>{title}</h1>
      <a href="/">返回活動列表</a>
    </header>
    <main className={styles.column}>
      {notice && <p role="status" className={notice.kind === "error" ? styles.error : styles.notice}>{notice.message}</p>}
      <WorkspaceEntries current={current} />
      <section className={styles.card} aria-labelledby="sign-in-title">
        <h2 id="sign-in-title">登入</h2>
        <LoginLinkForm audience={current} circleId={circleId} />
        {children}
      </section>
    </main>
  </div>;
}

function errorMessage(error: unknown) {
  return error instanceof PortalError || error instanceof Error ? error.message : "操作失敗，請稍後再試。";
}

/**
 * Email, the human check and the send button. `email` fixes the address to an
 * account already signed in, which only needs a link of another audience:
 * signing in through an organizer link is what accepts an invitation.
 */
export function LoginLinkForm({ audience, circleId, email: fixedEmail }: { audience: Workspace; circleId?: string; email?: string }) {
  const [email, setEmail] = useState(fixedEmail ?? "");
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "ok" | "error"; message: string }>({ kind: "idle", message: "" });
  const [sitekey, setSitekey] = useState<string | null>(null);
  const [humanToken, setHumanToken] = useState<string | null>(null);
  // A Turnstile token is single-use and short-lived. Remounting the widget is
  // what issues the next one, so every submit bumps this.
  const [generation, setGeneration] = useState(0);

  // Only the sign-in view asks for the sitekey; a signed-in workspace never
  // pays for the round trip.
  useEffect(() => {
    void readTurnstileSitekey().then(setSitekey).catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
  }, []);
  const onUnavailable = useCallback(() => setStatus({ kind: "error", message: "真人驗證元件載入失敗，請檢查網路或內容封鎖設定後重新整理。" }), []);

  const fieldId = `${audience}-sign-in-email`;
  return <div className={styles.form}>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!humanToken) return;
      setStatus({ kind: "busy", message: "寄送中…" });
      void requestLoginLink(email, humanToken, audience, circleId || undefined)
        .then(() => setStatus({ kind: "ok", message: "若這個 email 可以使用，登入連結已寄出。請一併檢查垃圾郵件匣。" }))
        .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }))
        .finally(() => {
          // Spent either way: the server verifies the token before it decides
          // anything else, so it is never reusable for a second attempt.
          setHumanToken(null);
          setGeneration((value) => value + 1);
        });
    }}>
      {fixedEmail ? <p className={styles.fixedEmail}>寄到 {fixedEmail}</p> : <>
        <label htmlFor={fieldId} className={styles.label}>Email</label>
        <input id={fieldId} className={styles.input} type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
      </>}
      {sitekey && <TurnstileWidget key={generation} sitekey={sitekey} onToken={setHumanToken} onUnavailable={onUnavailable} />}
      <button type="submit" className={styles.submit} disabled={!humanToken || status.kind === "busy"}>{status.kind === "busy" ? "寄送中…" : "寄出登入連結"}</button>
    </form>
    {/* Before the address is handed over, not after (ADR-0011, #30). Plain
        anchor: the notice is a static page outside this bundle. */}
    <p className={styles.fine}>送出即表示你已閱讀<a href="/privacy">隱私權與資料使用告知</a>。</p>
    {(status.kind === "ok" || status.kind === "error") && <p role="status" className={status.kind === "error" ? styles.error : styles.notice}>{status.message}</p>}
  </div>;
}

/** Fine print in the sign-in card's own style, for what one workspace adds under the form. */
export function SignInFinePrint({ children }: { children: ReactNode }) {
  return <p className={styles.fine}>{children}</p>;
}
