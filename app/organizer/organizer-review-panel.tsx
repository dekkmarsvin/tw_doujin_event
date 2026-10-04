/** 檢查與發布：檢查、送審、審閱與發布進度，一個動作一個元件。
 *
 * They were a single 46-line `<section>` sharing one `act()` and one notice,
 * which is why "已寄出邀請" and "已要求修改" came out of the same place at the
 * top of the workspace (#224). Each section owns its own field state and
 * feedback (#220) and is disabled rather than hidden when the role withholds
 * it (#217). Member management left for its own surface, reached from the
 * activity header (organizer-members-panel.tsx).
 */
import { useState } from "react";
import { ActionNotice, useActionFeedback } from "./organizer-feedback";
import { publicationProgress, publicationFailureMessage } from "../organizer-publication-presentation";
import { type PortalSession } from "../circle-editor-client";
import {
  reopenOrganizerEvent, retryOrganizerPublication,
  abandonOrganizerAmendment,
  reviewOrganizerEvent, submitOrganizerEvent, type OrganizerEventDetail,
} from "../organizer-client";
import { STATUS_LABEL, PUBLICATION_STATUS_LABEL } from "./organizer-shared";
import { CheckSection } from "./organizer-validation-panel";
import type { OrganizerWorkspaceSection } from "../organizer-workspace";
import styles from "./organizer.module.css";

export type SectionProps = {
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
  /** Set when the reader's role withholds this action. The controls stay on
   * the page and stop working; the reason is stated once at the top of the
   * panel rather than repeated under each of them (#217, #220). */
  blocked?: boolean;
};

/** One action, its own result line, its own busy flag. Reloading the workspace
 * happens only after the action succeeded, so a failure leaves the panel as it
 * was with the reason beside the control that produced it. */
export function useSectionAction({ onChanged, onUnauthorized }: Pick<SectionProps, "onChanged" | "onUnauthorized">) {
  const feedback = useActionFeedback(onUnauthorized);
  const act = <T,>(promise: Promise<T>, success: string | ((value: T) => string)) => {
    void feedback.run(promise, success).then((ok) => (ok ? onChanged() : undefined));
  };
  return { act, notice: feedback.notice, pending: feedback.pending };
}

function SubmitSection(props: SectionProps) {
  const { detail } = props;
  const { act, notice, pending: busy } = useSectionAction(props);
  const pending = busy || props.blocked === true;
  return <div className={styles.subpanel}><h4>送審</h4><p>{detail.event.operation === "AMEND" ? "送審會固定這一版的修正宣告、名單與地圖。核准後由系統自動發布；原公開版本會保留到修正部署完成。" : "送審後，活動代碼就不能再更改。"}</p><button type="button" disabled={pending || (detail.event.operation === "AMEND" && !detail.publicationAvailable)} onClick={() => act(submitOrganizerEvent(detail.event.id, detail.event.version), "已送交網站管理者審閱。")}>送出審閱</button><ActionNotice notice={notice} /></div>;
}

function AdminReviewSection(props: SectionProps) {
  const [note, setNote] = useState("");
  const { detail } = props;
  const { act, notice, pending: busy } = useSectionAction(props);
  const pending = busy || props.blocked === true;
  return <div className={styles.subpanel}><h4>網站管理者審閱</h4><p>核准即同意這一版送審內容公開，系統會自動開始發布。</p><p className={styles.warning}>若送審內容是你自己提交的，系統會另外記錄自我核准。</p><textarea aria-label="審閱說明" disabled={pending} placeholder="審閱說明" value={note} onChange={(event) => setNote(event.target.value)} /><div className={styles.row}><button type="button" className={styles.ghost} disabled={pending} onClick={() => act(reviewOrganizerEvent(detail.event.id, detail.event.version, "changes_requested", note), "已要求修改。")}>要求修改</button><button type="button" disabled={pending || !detail.publicationAvailable} onClick={() => act(reviewOrganizerEvent(detail.event.id, detail.event.version, "approve", note), "核准已記錄，請查看下方發布進度。")}>核准並發布</button></div><ActionNotice notice={notice} /></div>;
}

function ReopenSection(props: SectionProps & { reopenBlockedByRemoteState: boolean }) {
  const { detail, reopenBlockedByRemoteState } = props;
  const { act, notice, pending } = useSectionAction(props);
  const [reopenReason, setReopenReason] = useState("");
  return reopenBlockedByRemoteState ? <div className={styles.subpanel}><h4>退回修改</h4><p className={styles.warning}>發布儲存庫已有這筆工作的遠端紀錄，無法安全退回修改；請聯絡網站管理者。</p></div> : <div className={styles.subpanel}><h4>退回修改</h4><p>系統會先確認是否可安全退回修改；完成後會保留活動代碼與歷史記錄，讓你繼續編輯。</p><textarea aria-label="退回理由" required maxLength={1000} placeholder="請填寫退回理由" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} /><button type="button" disabled={pending || !reopenReason.trim()} onClick={() => act(reopenOrganizerEvent(detail.event.id, detail.event.version, reopenReason), "已退回修改，現在可以繼續編輯活動內容。")}>退回修改</button><ActionNotice notice={notice} /></div>;
}

function PublicationSection(props: SectionProps & {
  session: PortalSession; owner: boolean; historicalPublication: boolean;
}) {
  const { detail, session, owner, historicalPublication } = props;
  const { act, notice, pending } = useSectionAction(props);
  if (!detail.publication) return null;
  return <div className={styles.subpanel} aria-live="polite"><h4>{historicalPublication ? "發布狀態（先前儲存的內容）" : "發布狀態"}</h4>{historicalPublication && <p className={styles.warning}>這是先前儲存內容的發布紀錄；舊工作不會再重試，是否可編輯依目前活動狀態決定。</p>}<p>{PUBLICATION_STATUS_LABEL[detail.publication.status] ?? "正在確認發布狀態"}</p>
      <ol>{publicationProgress(detail.publication).map((stage) => <li key={stage.label}>{stage.label}：{({ complete: "已完成", current: "處理中", failed: "未完成，發布停止", pending: "尚未開始" })[stage.state]}</li>)}</ol>
      {detail.event.status === "abandoned" ? <p>這次修正已終止，失敗紀錄保留。原公開內容未變；請在活動清單選擇已發布版本，再開始修正。</p> : <>
        {detail.publication.status !== "published" && !historicalPublication && <p>公開結果確認成功前，活動尚未完成發布。</p>}
        {detail.publication.status === "failed" && !historicalPublication && <p className={styles.warning}>{publicationFailureMessage(detail.publication, detail.publicationAvailable === true)}</p>}
        {(session.isAdmin || owner) && !historicalPublication && detail.publication.status === "failed" && detail.publication.retryable && <button type="button" disabled={!detail.publicationAvailable || pending} onClick={() => act(retryOrganizerPublication(detail.publication!.id), "已要求從失敗步驟繼續，請查看發布進度。")}>重試發布</button>}
      </>}
      <details><summary>技術詳細資訊</summary><p>工作：{detail.publication.id}</p><p>步驟：{detail.publication.step}</p>{detail.publication.failureCode && <p>錯誤代碼：{detail.publication.failureCode}</p>}{detail.publication.error && <p>{detail.publication.error}</p>}</details>
  <ActionNotice notice={notice} /></div>;
}

function RecoverySection(props: SectionProps) {
  const { act, notice, pending } = useSectionAction(props);
  const [pull, setPull] = useState("");
  const [reason, setReason] = useState("");
  const number = Number(pull);
  return <div className={styles.subpanel}>
    <h4>終止失敗修正</h4>
    <p>先合併資料還原 PR、關閉未合併的發布 PR。核對通過後會保留失敗紀錄，解除這次修正的鎖定；新修正需要重新送審。</p>
    <label>資料還原 PR 編號<input type="number" min="1" step="1" value={pull} disabled={pending} onChange={(event) => setPull(event.target.value)} /></label>
    <label>終止原因<textarea required maxLength={1000} value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} /></label>
    <button type="button" disabled={pending || !Number.isSafeInteger(number) || number < 1 || !reason.trim()}
      onClick={() => act(abandonOrganizerAmendment(props.detail.event.id, props.detail.event.version, number, reason), "已終止這次修正。請從已發布版本開始新的修正。")}>核對還原並終止</button>
    <ActionNotice notice={notice} />
  </div>;
}

export function ReviewPanel({ session, detail, onChanged, onSection }: {
  session: PortalSession;
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  onSection?: (section: OrganizerWorkspaceSection, target?: string) => void;
}) {
  // An expired session is the one cause the whole panel shares, so it stays
  // here rather than repeating under every action that hit the same 401.
  const [needsLogin, setNeedsLogin] = useState(false);
  const onUnauthorized = () => setNeedsLogin(true);
  const owner = detail.event.role === "owner";
  const historicalPublication = detail.publication !== null
    && detail.publication.candidateVersion !== detail.event.version;
  const reopenBlockedByRemoteState = detail.publication?.status === "failed"
    && detail.publication.candidateVersion === detail.event.version
    && detail.publication.started === true;
  const section = { detail, onChanged, onUnauthorized };
  const submittable = detail.event.status === "draft" || detail.event.status === "changes_requested";
  return <section className={styles.panel}>
    <h3>檢查與發布</h3>
    {needsLogin && <p><a href="/organizer?reauth=1">重新登入並返回這個活動</a></p>}
    <div className={styles.statusBoard}><span>目前狀態</span><strong>{STATUS_LABEL[detail.event.status]}</strong><span>活動代碼</span><strong>{detail.draft.event.id ?? "尚未設定"}</strong></div>
    <CheckSection detail={detail} onChanged={onChanged} onSection={onSection} />
    {/* Stated once, above the control it governs. #216 was this panel going
        blank on an admin who never got the owner grant: nothing on the page
        said what was missing, so the work looked finished and stuck. */}
    {submittable && !owner && <p className={styles.warning}>{session.isAdmin
      ? "送出審閱需要這個活動的負責人身分。可在「成員與權限」新增自己為負責人，從邀請信登入後再送審。"
      : "送出審閱需要負責人身分，請聯絡這個活動的負責人。"}</p>}
    {submittable && <SubmitSection {...section} blocked={!owner} />}
    {session.isAdmin && detail.event.status === "submitted" && <AdminReviewSection {...section} />}
    {session.isAdmin && detail.recoveryAvailable ? <RecoverySection {...section} />
      : (session.isAdmin || owner) && detail.event.status === "failed" && !historicalPublication && <ReopenSection {...section} reopenBlockedByRemoteState={reopenBlockedByRemoteState} />}
    {!detail.publicationAvailable && detail.event.status !== "published" && <p className={styles.warning}>自動發布尚未啟用，{detail.event.operation === "AMEND" ? "本次修正" : "活動"}尚未公開。內容會保留，請聯絡網站管理者完成發布啟用檢查。</p>}
    <PublicationSection {...section} session={session} owner={owner} historicalPublication={historicalPublication} />
  </section>;
}
