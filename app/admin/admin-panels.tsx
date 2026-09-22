import { useCallback, useEffect, useRef, useState } from "react";
import { decideClaim, disableAccount, listAdmins, listPendingClaims, manageAdmin, PortalError, takedownOverride, type AdminEntry, type PendingClaim } from "../circle-editor-client";
import type { EventDefinition } from "../event-catalog";
import styles from "../circle-portal/portal.module.css";
type Status = { kind: "idle" | "busy" | "ok" | "error"; message: string };
const IDLE: Status = { kind: "idle", message: "" };
function errorMessage(error: unknown) { return error instanceof PortalError || error instanceof Error ? error.message : "操作失敗，請稍後再試。"; }

export function AdminPanel({ event }: { event: EventDefinition }) {
  const [pending, setPending] = useState<PendingClaim[]>([]);
  const [claimStatus, setClaimStatus] = useState<Status>(IDLE);
  const [takedownStatus, setTakedownStatus] = useState<Status>(IDLE);
  const [takedownId, setTakedownId] = useState("");
  const [reason, setReason] = useState("");

  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const requestVersion = useRef({ version: 0 });

  /**
   * `announce` is what the button says out loud. The queue also refreshes on a
   * timer and on every return to the tab, and letting those flip the label to
   * 「更新中…」 blinked a control nobody had pressed, twice a minute, to report
   * nothing the reader could act on. Only the first load and a press of the
   * button move it; a background answer still replaces the list and still
   * reports a failure, it just does not animate the control.
   */
  const refresh = useCallback((announce: boolean) => {
    const version = ++requestVersion.current.version;
    if (announce) setLoading(true);
    void listPendingClaims()
      .then((result) => {
        if (version !== requestVersion.current.version) return;
        setPending(result.claims);
        setLoaded(true);
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (version === requestVersion.current.version) setLoadError(errorMessage(error));
      })
      // Unconditional for an announced request: the button is disabled while
      // one is in flight, so no second announced request can supersede it and
      // leave the label stuck on 「更新中…」.
      .finally(() => {
        if (announce) setLoading(false);
      });
  }, []);

  useEffect(() => {
    const requests = requestVersion.current;
    const initialRefresh = window.setTimeout(() => refresh(true), 0);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refresh(false);
    };
    const timer = window.setInterval(refreshVisible, 30_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      ++requests.version;
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  const decide = (claimId: string, decision: "approve" | "reject") => {
    void decideClaim(claimId, decision)
      .then(() => refresh(false))
      .catch((error: unknown) => {
        setClaimStatus({ kind: "error", message: errorMessage(error) });
      });
  };

  return <section className={`${styles.card} ${styles.admin}`} id="admin">
    <h2>管理：待審認領</h2>
    <p className={styles.editorHint}>目前活動：{event.name}。認領逐場活動分開，同名社團在不同活動是不同的認領。</p>
    <button type="button" onClick={() => refresh(true)} disabled={loading}>{loading ? "更新中…" : "重新整理待審認領"}</button>
    {loadError && <p className={styles.error} role="alert">{loadError}</p>}
    {pending.length === 0 ? loaded && !loadError && <p>目前沒有待審項目。</p> : <ul className={styles.claimList}>
      {pending.map((claim) => <li key={claim.id}>
        <div>
          <b>{claim.circleName}</b>
          <small>{claim.circleId}</small>
          {claim.evidenceUrl && <a href={claim.evidenceUrl} target="_blank" rel="noreferrer">佐證連結</a>}
          {claim.evidenceNote && <small>{claim.evidenceNote}</small>}
        </div>
        <button type="button" onClick={() => decide(claim.id, "approve")}>核准</button>
        <button type="button" onClick={() => decide(claim.id, "reject")}>婉拒</button>
      </li>)}
    </ul>}
    {/* Under the queue rather than at the foot of the panel: an error about
        核准 belongs where 核准 is, not four fields further down. */}
    {claimStatus.kind === "error" && <p className={styles.error} role="alert">{claimStatus.message}</p>}

    <h2>撤下社團補充資料</h2>
    <label htmlFor="takedown-circle">社團 ID</label>
    <input id="takedown-circle" value={takedownId} onChange={(event) => setTakedownId(event.target.value)} placeholder="c-000001" />
    <label htmlFor="takedown-reason">原因</label>
    <input id="takedown-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
    <button type="button" onClick={() => {
      void takedownOverride(takedownId, reason)
        .then(() => { setTakedownStatus({ kind: "ok", message: "已撤下。" }); setTakedownId(""); setReason(""); })
        .catch((error: unknown) => {
          setTakedownStatus({ kind: "error", message: errorMessage(error) });
        });
    }}>撤下</button>
    {takedownStatus.kind !== "idle" && <p className={takedownStatus.kind === "error" ? styles.error : styles.notice}>{takedownStatus.message}</p>}

    <AdminRoster />
  </section>;
}

function AdminRoster() {
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [self, setSelf] = useState("");
  const [email, setEmail] = useState("");
  const [rosterStatus, setRosterStatus] = useState<Status>(IDLE);
  const [disableStatus, setDisableStatus] = useState<Status>(IDLE);
  const [disableEmail, setDisableEmail] = useState("");

  const refresh = useCallback(() => {
    void listAdmins()
      .then((result) => { setAdmins(result.admins); setSelf(result.self); })
      .catch((error: unknown) => {
        setRosterStatus({ kind: "error", message: errorMessage(error) });
      });
  }, []);

  useEffect(refresh, [refresh]);

  const run = (target: string, action: "add" | "remove") => {
    setRosterStatus({ kind: "busy", message: "處理中…" });
    void manageAdmin(target, action)
      .then(() => { setRosterStatus({ kind: "ok", message: action === "add" ? "已新增管理者。" : "已移除管理者。" }); setEmail(""); refresh(); })
      .catch((error: unknown) => {
        setRosterStatus({ kind: "error", message: errorMessage(error) });
      });
  };

  return <>
    <h2>管理者名單</h2>
    <ul className={styles.claimList}>
      {admins.map((admin) => <li key={admin.email}>
        <div>
          <b>{admin.email}{admin.email === self ? "（你）" : ""}</b>
          <small>{admin.addedBy === "bootstrap" ? "由設定值建立" : `由 ${admin.addedBy ?? "未知"} 新增`}</small>
        </div>
        {admin.email !== self && admins.length > 1
          && <button type="button" onClick={() => run(admin.email, "remove")}>移除</button>}
      </li>)}
    </ul>

    <label htmlFor="admin-email">新增管理者 email</label>
    <input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="someone@example.com" />
    <button type="button" disabled={rosterStatus.kind === "busy"} onClick={() => run(email, "add")}>新增</button>

    {rosterStatus.kind !== "idle" && rosterStatus.kind !== "busy" && <p className={rosterStatus.kind === "error" ? styles.error : styles.notice}>{rosterStatus.message}</p>}

    <h3>停用帳號</h3>
    <p>停用會立即撤銷該帳號的登入狀態，但保留資料供身分確認或後續刪除請求。</p>
    <label htmlFor="disable-account-email">帳號 email</label>
    <input id="disable-account-email" type="email" value={disableEmail} onChange={(event) => setDisableEmail(event.target.value)} />
    <button
      type="button"
      disabled={!disableEmail || disableStatus.kind === "busy"}
      onClick={() => {
        setDisableStatus({ kind: "busy", message: "處理中…" });
        void disableAccount(disableEmail)
          .then(() => { setDisableStatus({ kind: "ok", message: "帳號已停用。" }); setDisableEmail(""); })
          .catch((error: unknown) => {
            setDisableStatus({ kind: "error", message: errorMessage(error) });
          });
      }}
    >停用</button>
    {disableStatus.kind !== "idle" && disableStatus.kind !== "busy" && <p className={disableStatus.kind === "error" ? styles.error : styles.notice}>{disableStatus.message}</p>}
  </>;
}
