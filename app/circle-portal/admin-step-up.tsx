"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { adminSessionStale, signOut } from "../circle-editor-client";
import styles from "./portal.module.css";

/**
 * The admin step-up gate, stated once at the top of the panel it locks.
 *
 * Admin writes require a session created in the last 24 hours, so a reviewer
 * signed in since yesterday can read the queue and is refused the moment they
 * decide anything (`requireFreshAdmin`). The refusal used to arrive as one
 * more sentence in a status line at the foot of the panel, several controls
 * below whatever produced it, with no way to tell it from an ordinary failure.
 *
 * One session state locks every form in the panel, so it is said once, at the
 * top, with the sign-in that clears it — not repeated under each form. A notice
 * beneath a form is reserved for something only that form can report.
 */
type AdminStepUp = {
  /** Set by the first refusal. Nothing clears it but a new sign-in. */
  blocked: boolean;
  /**
   * Records a failure. Returns true when the step-up gate was the cause, which
   * means the caller should not also write its own error line: the banner
   * above already says it, once.
   */
  report: (error: unknown) => boolean;
  /** Signs out, so the next sign-in creates the fresh session the gate wants. */
  signInAgain: () => void;
  signingOut: boolean;
  /** Set when the sign-out itself failed, which leaves the gate where it was. */
  signOutError: string;
};

const IDLE: AdminStepUp = {
  blocked: false,
  report: () => false,
  signInAgain: () => undefined,
  signingOut: false,
  signOutError: "",
};

const AdminStepUpContext = createContext<AdminStepUp>(IDLE);

export function useAdminStepUp() {
  return useContext(AdminStepUpContext);
}

export function AdminStepUpProvider({ onSignedOut, children }: { onSignedOut: () => void; children: ReactNode }) {
  const [blocked, setBlocked] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  const report = useCallback((error: unknown) => {
    if (!adminSessionStale(error)) return false;
    setBlocked(true);
    return true;
  }, []);

  const signInAgain = useCallback(() => {
    setSigningOut(true);
    setSignOutError("");
    // On success the portal drops back to the sign-in form and this whole
    // subtree goes with it, so only the failure path has anything to reset. A
    // failed sign-out leaves the stale session in place — the state the reader
    // is already in — so it is said rather than hidden behind a dead button.
    void signOut().then(onSignedOut).catch(() => {
      setSigningOut(false);
      setSignOutError("登出沒有成功，請重新整理頁面後再試一次。");
    });
  }, [onSignedOut]);

  const value = useMemo(
    () => ({ blocked, report, signInAgain, signingOut, signOutError }),
    [blocked, report, signInAgain, signingOut, signOutError],
  );
  return <AdminStepUpContext.Provider value={value}>{children}</AdminStepUpContext.Provider>;
}

/** Sits at the top of an admin panel, above the forms it has turned off. */
export function AdminStepUpBanner() {
  const { blocked, signInAgain, signingOut, signOutError } = useAdminStepUp();
  if (!blocked) return null;
  return <p className={styles.stepUp} role="alert">
    管理功能被鎖定，需要重新登入。
    <button type="button" className={styles.inlineButton} disabled={signingOut} onClick={signInAgain}>
      {signingOut ? "登出中…" : "登出並重新登入"}
    </button>
    {signOutError && <span>{signOutError}</span>}
  </p>;
}
