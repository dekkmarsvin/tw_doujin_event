import styles from "./workspace-nav.module.css";

/**
 * The two places someone signs in to work (#439): circle data at `/circle` and
 * event authoring at `/organizer`. The public header's "登入" lands on the
 * first, so both name each other, or an organizer would have to know the
 * second address.
 *
 * Plain links between two separate entries, not tabs: each workspace still
 * decides for itself what this account may do there, so choosing one grants
 * nothing. Neither workspace is imported here, so neither surface downloads
 * the other by showing this.
 */
export type Workspace = "circle" | "organizer";

const WORKSPACES = [
  { id: "circle", href: "/circle", label: "社團資料", description: "認領社團、更新介紹與品書" },
  { id: "organizer", href: "/organizer", label: "主辦工作區", description: "建置活動、管理攤位與地圖" },
] as const;

/** Before sign-in: both workspaces side by side, each saying what it is for. */
export function WorkspaceEntries({ current, className }: { current: Workspace; className?: string }) {
  return <div className={className ? `${styles.entries} ${className}` : styles.entries}>
    <nav aria-label="工作區">
      <ul>{WORKSPACES.map((workspace) => <li key={workspace.id}>
        <a href={workspace.href} aria-current={workspace.id === current ? "page" : undefined}><b>{workspace.label}</b><small>{workspace.description}</small></a>
      </li>)}</ul>
    </nav>
    {/* What each workspace opens lives on its own public page, so signing in
        stays one short step for people who already know. */}
    <p><a href="/portal/" className={styles.introLink}>第一次使用？看看社團和主辦能做什麼</a></p>
  </div>;
}

/** Signed in: the same two by name only, beside the account they belong to. */
export function WorkspaceSwitch({ current }: { current: Workspace }) {
  return <nav aria-label="工作區" className={styles.switch}>
    {WORKSPACES.map((workspace) => <a key={workspace.id} href={workspace.href} aria-current={workspace.id === current ? "page" : undefined}>{workspace.label}</a>)}
  </nav>;
}

/** Both workspaces tell people to contact the maintainers; this is where. Set in Admin. */
export function ContactLink({ url, className }: { url?: string; className?: string }) {
  return url ? <a href={url} className={className} target="_blank" rel="noopener noreferrer">聯絡管理者</a> : null;
}
