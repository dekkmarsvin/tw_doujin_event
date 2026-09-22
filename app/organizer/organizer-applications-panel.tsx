import { useCallback, useEffect, useRef, useState } from "react";
import type { PortalSession } from "../circle-editor-client";
import { APPLICATION_RELATIONSHIPS, type OrganizerApplication, type OrganizerApplicationInput } from "../organizer-applications";
import { listEventApplications, reviewEventApplication, submitEventApplication } from "../organizer-client";
import { IDLE, message, type Notice } from "./organizer-shared";
import styles from "./organizer.module.css";

const EMPTY: OrganizerApplicationInput = { name: "", officialUrl: "", startDate: "", endDate: "", location: "", relationship: "organizer", note: "" };
const STATUS = { pending: "待審核", approved: "已核准建置", rejected: "未核准" };

export function OrganizerApplicationsPanel({ session, onReviewed }: { session: PortalSession; onReviewed?: () => Promise<void> }) {
  const [applications, setApplications] = useState<OrganizerApplication[]>([]);
  const [canApply, setCanApply] = useState(Boolean(session.canApplyForEvent));
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState<OrganizerApplicationInput>(EMPTY);
  const [notice, setNotice] = useState<Notice>(IDLE);
  const [busy, setBusy] = useState(false);
  const submission = useRef<{ json: string; id: string } | null>(null);
  const reload = useCallback(async () => {
    const result = await listEventApplications();
    setApplications(result.applications); setCanApply(result.canApply); setLoaded(true);
  }, []);
  useEffect(() => { queueMicrotask(() => { void reload().catch((error) => setNotice({ kind: "error", message: message(error) })); }); }, [reload]);
  const update = <K extends keyof OrganizerApplicationInput>(key: K, value: OrganizerApplicationInput[K]) => {
    setInput((current) => ({ ...current, [key]: value })); setNotice(IDLE);
  };

  return <section className={styles.applications} aria-labelledby="applications-title">
    <div className={styles.applicationHeading}>
      <h2 id="applications-title">{session.isAdmin ? "活動申請" : "我的活動申請"}</h2>
      <button type="button" className={styles.ghost} disabled={busy} onClick={() => {
        setBusy(true); setNotice(IDLE);
        void reload().catch((error) => setNotice({ kind: "error", message: message(error) })).finally(() => setBusy(false));
      }}>更新狀態</button>
    </div>
    {notice.kind !== "idle" && <p role="status" className={notice.kind === "error" ? styles.error : styles.notice}>{notice.message}</p>}
    {!loaded && <p>載入申請…</p>}
    {loaded && applications.length === 0 && <p>目前沒有申請。</p>}
    <div className={styles.stack}>
      {applications.map((application) => <ApplicationCard key={application.id} application={application} session={session} onReviewed={async () => {
        await reload(); await onReviewed?.();
      }} />)}
    </div>
    {canApply && <form className={styles.applicationForm} onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setNotice(IDLE);
      const json = JSON.stringify(input);
      if (submission.current?.json !== json) submission.current = { json, id: crypto.randomUUID() };
      void submitEventApplication(submission.current.id, input).then(async ({ application }) => {
        setApplications((current) => [application, ...current.filter((item) => item.id !== application.id)]);
        setInput(EMPTY); submission.current = null;
        setNotice({ kind: "ok", message: "申請已送出，請在此查看審核結果。" });
      }).catch((error) => setNotice({ kind: "error", message: message(error) })).finally(() => setBusy(false));
    }}>
      <h3>申請建置活動</h3>
      <p>主辦、獲授權人員或資料整理者皆可申請。核准後可準備活動資料，發布前仍須送審。</p>
      <fieldset disabled={busy} className={styles.applicationFields}>
        <label>活動名稱<input required maxLength={120} value={input.name} onChange={(event) => update("name", event.target.value)} /></label>
        <label>官方網站或官方社群網址<input type="url" required maxLength={2048} placeholder="https://" value={input.officialUrl} onChange={(event) => update("officialUrl", event.target.value)} /></label>
        <div className={styles.applicationDates}>
          <label>預計開始日期<input type="date" required value={input.startDate} onChange={(event) => update("startDate", event.target.value)} /></label>
          <label>預計結束日期<input type="date" required min={input.startDate} value={input.endDate} onChange={(event) => update("endDate", event.target.value)} /></label>
        </div>
        <label>預計地點（未定可留空）<input maxLength={200} value={input.location} onChange={(event) => update("location", event.target.value)} /></label>
        <label>與活動的關係<select value={input.relationship} onChange={(event) => update("relationship", event.target.value as OrganizerApplicationInput["relationship"])}>
          {Object.entries(APPLICATION_RELATIONSHIPS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>{input.relationship === "curator" ? "整理理由" : "申請說明（選填）"}<textarea required={input.relationship === "curator"} maxLength={1000} rows={3} value={input.note} onChange={(event) => update("note", event.target.value)} /></label>
        <button type="submit">{busy ? "送出中…" : "送出申請"}</button>
      </fieldset>
    </form>}
    {loaded && !canApply && !session.isAdmin && <p>目前未開放新申請，已送出的申請仍可在此查看。</p>}
  </section>;
}

function ApplicationCard({ application, session, onReviewed }: {
  application: OrganizerApplication; session: PortalSession; onReviewed: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(IDLE);
  return <article className={styles.applicationCard} aria-label={application.name}>
    <h3>{application.name}</h3><strong>{STATUS[application.status]}</strong>
    {application.officialUrl && <dl>
      <dt>官方來源</dt><dd><a href={application.officialUrl} target="_blank" rel="noreferrer">{application.officialUrl}</a></dd>
      <dt>預計日期</dt><dd>{application.startDate} ～ {application.endDate}</dd>
      <dt>預計地點</dt><dd>{application.location || "未定"}</dd>
      <dt>申請身分</dt><dd>{APPLICATION_RELATIONSHIPS[application.relationship]}</dd>
      {session.isAdmin && <><dt>申請帳號</dt><dd>{application.applicantEmail ?? "帳號已刪除"}</dd></>}
      {application.note && <><dt>申請說明</dt><dd>{application.note}</dd></>}
    </dl>}
    {application.reason && <p>審核說明：{application.reason}</p>}
    {application.status === "approved" && application.candidateId && <a href="/organizer" onClick={() => {
      try { localStorage.setItem(`organizer.resumeCandidate:${session.email}`, application.candidateId!); } catch { /* Optional preference. */ }
    }}>進入活動工作區</a>}
    {session.isAdmin && application.status === "pending" && <form className={styles.applicationReview} onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setNotice(IDLE);
      void reviewEventApplication(application.id, decision, reason).then(async () => {
        setNotice({ kind: "ok", message: decision === "approved" ? "已核准建置活動。" : "已拒絕申請。" });
        await onReviewed();
      }).catch((error) => setNotice({ kind: "error", message: message(error) })).finally(() => setBusy(false));
    }}>
      <p>核對官方來源後再決定。若活動已存在，請拒絕這份新活動申請，改由既有活動邀請協作者。</p>
      <fieldset disabled={busy} className={styles.applicationFields}>
        <label>審核結果<select value={decision} onChange={(event) => setDecision(event.target.value as "approved" | "rejected")}>
          <option value="approved">核准建置</option><option value="rejected">拒絕申請</option>
        </select></label>
        <label>審核說明{decision === "rejected" ? "（必填）" : "（選填）"}<textarea required={decision === "rejected"} maxLength={1000} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button type="submit">{busy ? "儲存中…" : "確認審核"}</button>
      </fieldset>
    </form>}
    {notice.kind !== "idle" && <p role="status" className={notice.kind === "error" ? styles.error : styles.notice}>{notice.message}</p>}
  </article>;
}
