/** The five things the review panel does, one component each.
 *
 * They were a single 46-line `<section>` sharing one `act()` and one notice,
 * which is why "已寄出邀請" and "已要求修改" came out of the same place at the
 * top of the workspace (#224). Splitting them is structural: each section owns
 * its own field state and renders the same markup, and they still share the
 * shell's `act` and `pending` so this change moves no behaviour. Giving each
 * action its own feedback is #220; disabling instead of hiding is #217. Both
 * now have somewhere to land.
 */
import { useState, type FormEvent } from "react";
import { publicationProgress, publicationFailureMessage } from "../organizer-publication-presentation";
import { PortalError, type PortalSession } from "../circle-editor-client";
import {
  manageOrganizerEditor, manageOrganizerOwner, reopenOrganizerEvent, retryOrganizerPublication,
  reviewOrganizerEvent, submitOrganizerEvent, type OrganizerEventDetail,
} from "../organizer-client";
import { message, STATUS_LABEL, PUBLICATION_STATUS_LABEL, type Notice } from "./organizer-shared";
import styles from "./organizer.module.css";

type Act = (promise: Promise<unknown>, success: string) => void;
type SectionProps = { detail: OrganizerEventDetail; act: Act; pending: boolean };

function CollaboratorSection({ detail, act }: SectionProps) {
  const [editorEmail, setEditorEmail] = useState("");
  return <div className={styles.subpanel}><h4>協作者</h4><form className={styles.row} onSubmit={(event: FormEvent) => { event.preventDefault(); act(manageOrganizerEditor(detail.event.id, editorEmail, "invite"), "協作者邀請已寄出。"); }}><input type="email" required placeholder="editor@example.com" value={editorEmail} onChange={(event) => setEditorEmail(event.target.value)} /><button type="submit">邀請協作者</button><button type="button" className={styles.dangerText} disabled={!editorEmail} onClick={() => act(manageOrganizerEditor(detail.event.id, editorEmail, "revoke"), "已移除這位協作者。")}>移除此協作者</button></form></div>;
}

function OwnerSection({ detail, act }: SectionProps) {
  const [ownerEmail, setOwnerEmail] = useState("");
  return <div className={styles.subpanel}><h4>負責人</h4><p>只有網站管理者可增減負責人；每場活動至少保留一位。</p><form className={styles.row} onSubmit={(event: FormEvent) => { event.preventDefault(); act(manageOrganizerOwner(detail.event.id, ownerEmail, "invite"), "負責人邀請已寄出。"); }}><input type="email" required placeholder="owner@example.com" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} /><button type="submit">新增負責人</button><button type="button" className={styles.dangerText} disabled={!ownerEmail} onClick={() => act(manageOrganizerOwner(detail.event.id, ownerEmail, "revoke"), "已移除這位負責人。")}>移除此負責人</button></form></div>;
}

function SubmitSection({ detail, act }: SectionProps) {
  return <div className={styles.subpanel}><h4>送審</h4><p>{detail.event.operation === "AMEND" ? "送審會固定這一版的修正宣告、名單與地圖。核准後由系統自動發布；原公開版本會保留到修正部署完成。" : "送審後，活動代碼就不能再更改。"}</p><button type="button" disabled={detail.event.operation === "AMEND" && !detail.publicationAvailable} onClick={() => act(submitOrganizerEvent(detail.event.id, detail.event.version), "已送交網站管理者審閱。")}>送出審閱</button></div>;
}

function AdminReviewSection({ detail, act }: SectionProps) {
  const [note, setNote] = useState("");
  return <div className={styles.subpanel}><h4>網站管理者審閱</h4><p>核准即同意這一版送審內容公開，系統會自動開始發布。</p><p className={styles.warning}>若送審內容是你自己提交的，系統會另外記錄自我核准。</p><textarea aria-label="審閱說明" placeholder="審閱說明" value={note} onChange={(event) => setNote(event.target.value)} /><div className={styles.row}><button type="button" className={styles.ghost} onClick={() => act(reviewOrganizerEvent(detail.event.id, detail.event.version, "changes_requested", note), "已要求修改。")}>要求修改</button><button type="button" disabled={!detail.publicationAvailable} onClick={() => act(reviewOrganizerEvent(detail.event.id, detail.event.version, "approve", note), "核准已記錄，請查看下方發布進度。")}>核准並發布</button></div></div>;
}

function ReopenSection({ detail, act, pending, reopenBlockedByRemoteState }: SectionProps & { reopenBlockedByRemoteState: boolean }) {
  const [reopenReason, setReopenReason] = useState("");
  return reopenBlockedByRemoteState ? <div className={styles.subpanel}><h4>退回修改</h4><p className={styles.warning}>發布儲存庫已有這筆工作的遠端紀錄，無法安全退回修改；請聯絡網站管理者。</p></div> : <div className={styles.subpanel}><h4>退回修改</h4><p>系統會先確認是否可安全退回修改；完成後會保留活動代碼與歷史記錄，讓你繼續編輯。</p><textarea aria-label="退回理由" required maxLength={1000} placeholder="請填寫退回理由" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} /><button type="button" disabled={pending || !reopenReason.trim()} onClick={() => act(reopenOrganizerEvent(detail.event.id, detail.event.version, reopenReason), "已退回修改，現在可以繼續編輯活動內容。")}>退回修改</button></div>;
}

function PublicationSection({ detail, session, act, pending, owner, historicalPublication }: SectionProps & {
  session: PortalSession; owner: boolean; historicalPublication: boolean;
}) {
  if (!detail.publication) return null;
  return <div className={styles.subpanel} aria-live="polite"><h4>{historicalPublication ? `發布狀態（第 ${detail.publication.candidateVersion} 版歷史紀錄）` : "發布狀態"}</h4>{historicalPublication && <p className={styles.warning}>這是舊版本的發布紀錄，目前版本為第 {detail.event.version} 版；舊工作不會再重試，是否可編輯依目前活動狀態決定。</p>}<p>{PUBLICATION_STATUS_LABEL[detail.publication.status] ?? "正在確認發布狀態"}</p>
      <ol>{publicationProgress(detail.publication).map((stage) => <li key={stage.label}>{stage.label}：{({ complete: "已完成", current: "處理中", failed: "未完成，發布停止", pending: "尚未開始" })[stage.state]}</li>)}</ol>
      {detail.publication.status !== "published" && !historicalPublication && <p>公開結果確認成功前，活動尚未完成發布。</p>}
      {detail.publication.status === "failed" && !historicalPublication && <p className={styles.warning}>{publicationFailureMessage(detail.publication, detail.publicationAvailable === true)}</p>}
      {(session.isAdmin || owner) && !historicalPublication && detail.publication.status === "failed" && detail.publication.retryable && <button type="button" disabled={!detail.publicationAvailable || pending} onClick={() => act(retryOrganizerPublication(detail.publication!.id), "已要求從失敗步驟繼續，請查看發布進度。")}>重試發布</button>}
      <details><summary>技術詳細資訊</summary><p>工作：{detail.publication.id}</p><p>步驟：{detail.publication.step}</p>{detail.publication.failureCode && <p>錯誤代碼：{detail.publication.failureCode}</p>}{detail.publication.error && <p>{detail.publication.error}</p>}</details>
  </div>;
}

export function ReviewPanel({ session, detail, onChanged, setNotice }: {
  session: PortalSession;
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const [needsLogin, setNeedsLogin] = useState(false);
  const [pending, setPending] = useState(false);
  const owner = detail.event.role === "owner";
  const act: Act = (promise, success) => {
    setPending(true);
    setNotice({ kind: "busy", message: "處理中…" });
    void promise.then(async () => { setNotice({ kind: "ok", message: success }); await onChanged(); }).catch((error) => {
      if (error instanceof PortalError && error.status === 401) setNeedsLogin(true);
      setNotice({ kind: "error", message: message(error) });
    }).finally(() => setPending(false));
  };
  const historicalPublication = detail.publication !== null
    && detail.publication.candidateVersion !== detail.event.version;
  const reopenBlockedByRemoteState = detail.publication?.status === "failed"
    && detail.publication.candidateVersion === detail.event.version
    && detail.publication.started === true;
  const section = { detail, act, pending };
  return <section className={styles.panel}>
    <h3>送審與發布狀態</h3>
    {needsLogin && <p><a href="/organizer?reauth=1">重新登入並返回這個活動</a></p>}
    <div className={styles.statusBoard}><span>目前狀態</span><strong>{STATUS_LABEL[detail.event.status]}</strong><span>活動代碼</span><strong>{detail.draft.event.id ?? "尚未設定"}</strong></div>
    {owner && <CollaboratorSection {...section} />}
    {session.isAdmin && <OwnerSection {...section} />}
    {owner && (detail.event.status === "draft" || detail.event.status === "changes_requested") && <SubmitSection {...section} />}
    {session.isAdmin && detail.event.status === "submitted" && <AdminReviewSection {...section} />}
    {(session.isAdmin || owner) && detail.event.status === "failed" && !historicalPublication && <ReopenSection {...section} reopenBlockedByRemoteState={reopenBlockedByRemoteState} />}
    {!detail.publicationAvailable && detail.event.status !== "published" && <p className={styles.warning}>自動發布尚未啟用，{detail.event.operation === "AMEND" ? "本次修正" : "活動"}尚未公開。內容會保留，請聯絡網站管理者完成發布啟用檢查。</p>}
    <PublicationSection {...section} session={session} owner={owner} historicalPublication={historicalPublication} />
  </section>;
}
