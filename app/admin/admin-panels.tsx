import { useCallback, useEffect, useState } from "react";
import { disableAccount, listAdmins, manageAdmin, PortalError, takedownOverride, type AdminEntry } from "../circle-editor-client";
import { PUBLISHED_EVENTS } from "../event-catalog";
import { eventsByProximity, taipeiDate } from "../event-calendar";
import styles from "../circle-portal/portal.module.css";
type Status = { kind: "idle" | "busy" | "ok" | "error"; message: string };
const IDLE: Status = { kind: "idle", message: "" };
function errorMessage(error: unknown) { return error instanceof PortalError || error instanceof Error ? error.message : "操作失敗，請稍後再試。"; }

/**
 * Takedown needs an event: a circle id is only meaningful inside one. The
 * picker lives on the form instead of heading the page, and the request names
 * that event itself, so it cannot follow whichever event the map review above
 * happens to have open.
 */
export function AdminTakedownPanel({ initialEventId }: { initialEventId: string }) {
  const [eventId, setEventId] = useState(initialEventId);
  const [takedownStatus, setTakedownStatus] = useState<Status>(IDLE);
  const [takedownId, setTakedownId] = useState("");
  const [reason, setReason] = useState("");

  return <section className={`${styles.card} ${styles.admin}`} id="takedown" aria-labelledby="takedown-heading">
    <h2 id="takedown-heading">撤下社團補充資料</h2>
    <AdminEventSelect id="takedown-event" value={eventId} onChange={setEventId} />
    <label htmlFor="takedown-circle">社團 ID</label>
    <input id="takedown-circle" value={takedownId} onChange={(event) => setTakedownId(event.target.value)} placeholder="c-000001" />
    <label htmlFor="takedown-reason">原因</label>
    <input id="takedown-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
    <button type="button" onClick={() => {
      void takedownOverride(takedownId, reason, eventId)
        .then(() => { setTakedownStatus({ kind: "ok", message: "已撤下。" }); setTakedownId(""); setReason(""); })
        .catch((error: unknown) => {
          setTakedownStatus({ kind: "error", message: errorMessage(error) });
        });
    }}>撤下</button>
    {takedownStatus.kind !== "idle" && <p className={takedownStatus.kind === "error" ? styles.error : styles.notice}>{takedownStatus.message}</p>}
  </section>;
}

/** Nothing to choose with one published event, so nothing is shown. */
export function AdminEventSelect({ id, value, onChange }: { id: string; value: string; onChange: (eventId: string) => void }) {
  const [today] = useState(() => taipeiDate(Date.now()));
  if (PUBLISHED_EVENTS.length < 2) return null;
  return <>
    <label htmlFor={id}>活動</label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {eventsByProximity(PUBLISHED_EVENTS, today).map(({ event, label, group }) => <option key={event.id} value={event.id}>
        {event.name}・{label}{group === "past" ? "（已結束）" : ""}
      </option>)}
    </select>
  </>;
}

export function AdminRoster() {
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

  return <section className={`${styles.card} ${styles.admin}`} id="accounts" aria-labelledby="accounts-heading">
    <h2 id="accounts-heading">管理者名單</h2>
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
  </section>;
}
