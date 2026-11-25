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
import { type PortalSession } from "../circle-editor-client";
import { reviewOrganizerEvent, submitOrganizerEvent, type OrganizerEventDetail } from "../organizer-client";
import { STATUS_LABEL } from "./organizer-shared";
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
  return <div className={styles.subpanel}><h4>送審</h4><p>{detail.event.operation === "AMEND" ? "送審後固定這一版修正內容；核准並發布後才會更新公開活動。" : "送審後，活動代碼就不能再更改。"}</p><button type="button" disabled={pending || (detail.event.operation === "AMEND" && !detail.publicationAvailable)} onClick={() => act(submitOrganizerEvent(detail.event.id, detail.event.version), "已送交網站管理者審閱。")}>送出審閱</button><ActionNotice notice={notice} /></div>;
}

function AdminReviewSection(props: SectionProps) {
  const [note, setNote] = useState("");
  const { detail } = props;
  const { act, notice, pending: busy } = useSectionAction(props);
  const pending = busy || props.blocked === true;
  const retry = detail.event.status === "approved";
  return <div className={styles.subpanel}><h4>網站管理者審閱</h4><p>{retry ? "這一版已核准，但發布沒有完成。再按一次「核准並發布」即可完成。" : "核准後會立即公開這一版送審內容。"}</p><p className={styles.warning}>若送審內容是你自己提交的，系統會另外記錄自我核准。</p><textarea aria-label="審閱說明" disabled={pending} placeholder="審閱說明" value={note} onChange={(event) => setNote(event.target.value)} /><div className={styles.row}>{!retry && <button type="button" className={styles.ghost} disabled={pending} onClick={() => act(reviewOrganizerEvent(detail.event.id, detail.event.version, "changes_requested", note), "已要求修改。")}>要求修改</button>}<button type="button" disabled={pending || !detail.publicationAvailable} onClick={() => act(reviewOrganizerEvent(detail.event.id, detail.event.version, "approve", note), "已核准並發布。")}>核准並發布</button></div><ActionNotice notice={notice} /></div>;
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
  const section = { detail, onChanged, onUnauthorized };
  const submittable = detail.event.status === "draft" || detail.event.status === "changes_requested";
  return <section className={styles.panel}>
    <h3>檢查與發布</h3>
    {needsLogin && <p><a href="/organizer?reauth=1">重新登入並返回這個活動</a></p>}
    <div className={styles.statusBoard}><span>目前狀態</span><strong>{STATUS_LABEL[detail.event.status]}</strong><span>活動代碼</span><strong>{detail.draft.event.id ?? "尚未設定"}</strong></div>
    <CheckSection detail={detail} onChanged={onChanged} onSection={onSection} />
    {submittable && <SubmitSection {...section} blocked={!owner && !session.isAdmin} />}
    {session.isAdmin && (detail.event.status === "submitted" || detail.event.status === "approved") && <AdminReviewSection {...section} />}
    {!detail.publicationAvailable && detail.event.status !== "published" && <p className={styles.warning}>發布尚未啟用，{detail.event.operation === "AMEND" ? "本次修正" : "活動"}尚未公開。內容會保留，請聯絡網站管理者協助發布。</p>}
    {detail.event.status === "abandoned" && <p>這次修正已終止，公開內容沒有改變。要再修正，請從活動清單的已發布版本開始。</p>}
  </section>;
}
