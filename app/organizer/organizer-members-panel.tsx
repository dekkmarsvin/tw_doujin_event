/** 成員與權限：邀請、重寄與移除協作者和負責人。
 *
 * Reached from the activity header rather than a preparation section: who may
 * work on an activity is not a step of getting it ready, and it used to sit
 * above the submit button where it read as one.
 */
import { useState, type FormEvent } from "react";
import { ActionNotice } from "./organizer-feedback";
import { type PortalSession } from "../circle-editor-client";
import { manageOrganizerEditor, manageOrganizerOwner, type OrganizerEventDetail } from "../organizer-client";
import { useSectionAction, type SectionProps } from "./organizer-review-panel";
import styles from "./organizer.module.css";

function invitationMessage(result: { invitationDelivery?: "sent" | "failed" | "unknown" }) {
  if (result.invitationDelivery === "sent") return "邀請信已寄出。";
  // Creation succeeded, but the action's mail failure still needs error feedback.
  throw new Error(result.invitationDelivery === "failed"
    ? "邀請已建立，邀請信未寄出。請按「重寄邀請信」。"
    : "邀請已建立，無法確認邀請信是否寄出。你可以重寄邀請信。");
}

function CollaboratorSection(props: SectionProps) {
  const [editorEmail, setEditorEmail] = useState("");
  const { detail } = props;
  const { act, notice, pending: busy } = useSectionAction(props);
  const pending = busy || props.blocked === true;
  return <div className={styles.subpanel}><h4>協作者</h4><form className={styles.invitationForm} onSubmit={(event: FormEvent) => { event.preventDefault(); act(manageOrganizerEditor(detail.event.id, editorEmail, "invite"), invitationMessage); }}><input aria-label="協作者 Email" type="email" required disabled={pending} placeholder="editor@example.com" value={editorEmail} onChange={(event) => setEditorEmail(event.target.value)} /><button type="submit" disabled={pending}>邀請協作者</button><button type="button" disabled={!editorEmail || pending} onClick={() => act(manageOrganizerEditor(detail.event.id, editorEmail, "resend"), invitationMessage)}>重寄邀請信</button><button type="button" className={styles.dangerText} disabled={!editorEmail || pending} onClick={() => act(manageOrganizerEditor(detail.event.id, editorEmail, "revoke"), "已移除這位協作者。")}>移除此協作者</button></form><ActionNotice notice={notice} /></div>;
}

function OwnerSection(props: SectionProps) {
  const [ownerEmail, setOwnerEmail] = useState("");
  const { detail } = props;
  const { act, notice, pending: busy } = useSectionAction(props);
  const pending = busy || props.blocked === true;
  return <div className={styles.subpanel}><h4>負責人</h4><p>每場活動至少保留一位已接受邀請的負責人。</p><form className={styles.invitationForm} onSubmit={(event: FormEvent) => { event.preventDefault(); act(manageOrganizerOwner(detail.event.id, ownerEmail, "invite"), invitationMessage); }}><input aria-label="負責人 Email" type="email" required disabled={pending} placeholder="owner@example.com" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} /><button type="submit" disabled={pending}>新增負責人</button><button type="button" disabled={!ownerEmail || pending} onClick={() => act(manageOrganizerOwner(detail.event.id, ownerEmail, "resend"), invitationMessage)}>重寄邀請信</button><button type="button" className={styles.dangerText} disabled={!ownerEmail || pending} onClick={() => act(manageOrganizerOwner(detail.event.id, ownerEmail, "revoke"), "已移除這位負責人。")}>移除此負責人</button></form><ActionNotice notice={notice} /></div>;
}

export function MembersPanel({ session, detail, onChanged, onClose }: {
  session: PortalSession;
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [needsLogin, setNeedsLogin] = useState(false);
  const owner = detail.event.role === "owner";
  const section = { detail, onChanged, onUnauthorized: () => setNeedsLogin(true) };
  return <section className={styles.panel}>
    <div className={styles.panelHead}>
      <div><h3>成員與權限</h3><p>負責人可管理成員、送出審閱；協作者可編輯活動內容。</p></div>
      <button type="button" className={styles.ghost} onClick={onClose}>返回活動資料</button>
    </div>
    {needsLogin && <p><a href="/organizer?reauth=1">重新登入並返回這個活動</a></p>}
    {!owner && <p className={styles.warning}>{session.isAdmin
      ? "管理協作者需要這個活動的負責人身分。" : "管理成員需要負責人身分，請聯絡這個活動的負責人。"}</p>}
    <CollaboratorSection {...section} blocked={!owner} />
    {(owner || session.isAdmin) && <OwnerSection {...section} />}
  </section>;
}
