/** 成員與權限：邀請、重寄與移除活動成員。
 *
 * Reached from the activity header rather than a preparation section: who may
 * work on an activity is not a step of getting it ready, and it used to sit
 * above the submit button where it read as one.
 */
import { useState, type FormEvent } from "react";
import { ActionNotice } from "./organizer-feedback";
import { manageOrganizerMember, type OrganizerEventDetail } from "../organizer-client";
import { useSectionAction } from "./organizer-review-panel";
import styles from "./organizer.module.css";

function invitationMessage(result: { invitationDelivery?: "sent" | "failed" | "unknown" }) {
  if (result.invitationDelivery === "sent") return "邀請信已寄出。";
  // Creation succeeded, but the action's mail failure still needs error feedback.
  throw new Error(result.invitationDelivery === "failed"
    ? "邀請已建立，邀請信未寄出。請按「重寄邀請信」。"
    : "邀請已建立，無法確認邀請信是否寄出。你可以重寄邀請信。");
}

/** Every member has the same rights (#546), so there is one list to manage. */
export function MembersPanel({ detail, onChanged, onClose }: {
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [needsLogin, setNeedsLogin] = useState(false);
  const [email, setEmail] = useState("");
  const { act, notice, pending } = useSectionAction({ onChanged, onUnauthorized: () => setNeedsLogin(true) });
  const id = detail.event.id;
  return <section className={styles.panel}>
    <div className={styles.panelHead}>
      <div><h3>成員與權限</h3><p>成員可以編輯活動內容、送出審閱，也可以邀請或移除其他成員。</p></div>
      <button type="button" className={styles.ghost} onClick={onClose}>返回活動資料</button>
    </div>
    {needsLogin && <p><a href="/organizer?reauth=1">重新登入並返回這個活動</a></p>}
    <div className={styles.subpanel}><h4>成員</h4><p>每場活動至少保留一位已接受邀請的成員。</p>
      <form className={styles.invitationForm} onSubmit={(event: FormEvent) => { event.preventDefault(); act(manageOrganizerMember(id, email, "invite"), invitationMessage); }}>
        <input aria-label="成員 Email" type="email" required disabled={pending} placeholder="member@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
        <button type="submit" disabled={pending}>邀請成員</button>
        <button type="button" disabled={!email || pending} onClick={() => act(manageOrganizerMember(id, email, "resend"), invitationMessage)}>重寄邀請信</button>
        <button type="button" className={styles.dangerText} disabled={!email || pending} onClick={() => act(manageOrganizerMember(id, email, "revoke"), "已移除這位成員。")}>移除此成員</button>
      </form>
      <ActionNotice notice={notice} />
    </div>
  </section>;
}
