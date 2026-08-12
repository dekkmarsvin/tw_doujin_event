"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createClaim, decideClaim, listMyClaims, listPendingClaims, PortalError, readMyOverride,
  readSession, requestLoginLink, runChallenge, saveOverride, searchCircles, signOut, takedownOverride, verifyLoginToken,
  type CircleMatch, type ClaimSummary, type PendingClaim, type PortalSession,
} from "../circle-editor-client";
import { OVERRIDE_LIMITS, type CircleOverrideFields } from "../circle-overrides";
import { FF47_EVENT } from "../event-catalog";
import styles from "./portal.module.css";

type Status = { kind: "idle" | "busy" | "ok" | "error"; message: string };

const IDLE: Status = { kind: "idle", message: "" };
const LIST_FIELDS = [
  { key: "referencedWorks", label: "參考作品／題材" },
  { key: "creatorTypes", label: "創作者類型" },
  { key: "workTypes", label: "作品類型" },
  { key: "ageRatings", label: "年齡分級" },
  { key: "specialTags", label: "特殊標籤" },
] as const;

function errorMessage(error: unknown) {
  return error instanceof PortalError || error instanceof Error ? error.message : "操作失敗，請稍後再試。";
}

/** Read and immediately erase the emailed token before anything can await. */
function takeLoginToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("login");
  if (!token) return null;
  url.searchParams.delete("login");
  window.history.replaceState(null, "", url);
  return token;
}

export default function CirclePortalApp() {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>(IDLE);
  const [claims, setClaims] = useState<ClaimSummary[]>([]);

  const refreshClaims = useCallback(async () => {
    try {
      setClaims((await listMyClaims()).claims);
    } catch {
      setClaims([]);
    }
  }, []);

  useEffect(() => {
    const token = takeLoginToken();
    void (async () => {
      if (token) {
        try {
          setSession(await verifyLoginToken(token));
          setStatus({ kind: "ok", message: "登入成功。" });
        } catch (error) {
          setStatus({ kind: "error", message: errorMessage(error) });
        }
      } else {
        try {
          setSession(await readSession());
        } catch {
          setSession(null);
        }
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!session) return;
    // Deferred like `use-planning.ts`: the load is async, but scheduling it out
    // of the effect body keeps the render pass free of cascading updates.
    queueMicrotask(() => { void refreshClaims(); });
  }, [refreshClaims, session]);

  return <div className={styles.page}>
    <header className={styles.masthead}>
      <div>
        <small>CIRCLE PORTAL</small>
        <h1>社團資料維護</h1>
        <p>{FF47_EVENT.name}・{FF47_EVENT.dateRangeLabel}</p>
      </div>
      {session && <div className={styles.identity}>
        <span>{session.email}</span>
        <button type="button" onClick={() => void signOut().then(() => { setSession(null); setClaims([]); })}>登出</button>
      </div>}
    </header>

    {status.kind !== "idle" && <p className={status.kind === "error" ? styles.error : styles.notice} role="status">{status.message}</p>}

    {!ready ? <p className={styles.notice}>載入中…</p>
      : !session ? <SignIn />
        : <>
          <ClaimList claims={claims} onChanged={refreshClaims} />
          <ClaimForm onCreated={refreshClaims} />
          {claims.filter((claim) => claim.status === "verified").map((claim) => <CircleEditor key={claim.circleId} claim={claim} />)}
          {session.isAdmin && <AdminPanel />}
        </>}

    <footer className={styles.footer}>
      <p>你在這裡填寫的內容會標示為「社團自述」，與主辦提供的攤位資料分開呈現。攤位與日期由主辦公布，無法在此修改。</p>
    </footer>
  </div>;
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(IDLE);

  return <section className={styles.card}>
    <h2>登入</h2>
    <p>輸入 email，我們會寄一封只能使用一次的登入連結給你（15 分鐘內有效）。</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      setStatus({ kind: "busy", message: "寄送中…" });
      void requestLoginLink(email)
        .then(() => setStatus({ kind: "ok", message: "若這個 email 可以使用，登入連結已寄出。請一併檢查垃圾郵件匣。" }))
        .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
    }}>
      <label htmlFor="portal-email">Email</label>
      <input id="portal-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
      <button type="submit" disabled={status.kind === "busy"}>{status.kind === "busy" ? "寄送中…" : "寄出登入連結"}</button>
    </form>
    {status.kind !== "idle" && status.kind !== "busy" && <p className={status.kind === "error" ? styles.error : styles.notice}>{status.message}</p>}
  </section>;
}

function ClaimList({ claims, onChanged }: { claims: ClaimSummary[]; onChanged: () => void }) {
  const [status, setStatus] = useState<Status>(IDLE);
  if (claims.length === 0) return null;

  return <section className={styles.card}>
    <h2>我的社團</h2>
    <ul className={styles.claimList}>
      {claims.map((claim) => <li key={claim.id}>
        <div>
          <b>{claim.circleName}</b>
          <small>{claim.circleId}</small>
        </div>
        <span className={styles[`claim_${claim.status}`]}>{
          { pending: "審核中", verified: "已通過", rejected: "已婉拒", revoked: "已撤銷" }[claim.status]
        }</span>
        {claim.status === "pending" && claim.targetUrl && <button type="button" onClick={() => {
          setStatus({ kind: "busy", message: "驗證中…" });
          void runChallenge(claim.id)
            .then((result) => {
              setStatus({ kind: result.verified ? "ok" : "error", message: result.verified ? "驗證通過。" : result.error ?? "尚未找到驗證碼。" });
              onChanged();
            })
            .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
        }}>重新驗證</button>}
      </li>)}
    </ul>
    {status.kind !== "idle" && <p className={status.kind === "error" ? styles.error : styles.notice}>{status.message}</p>}
  </section>;
}

/**
 * Server-side search. Downloading the catalog here would force it to be public,
 * which is exactly what the access gate is holding back until the source
 * licensing review lands.
 */
function useCircleSearch(query: string) {
  const [matches, setMatches] = useState<CircleMatch[]>([]);
  // Derived rather than cleared in the effect: a too-short query has no results
  // by definition, so there is nothing to synchronise and nothing to flash.
  const active = query.trim().length >= 2;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchCircles(query)
        .then((result) => { if (!cancelled) setMatches(result.circles); })
        .catch(() => { if (!cancelled) setMatches([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, query]);

  return active ? matches : [];
}

function ClaimForm({ onCreated }: { onCreated: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CircleMatch | null>(null);
  const [targetUrl, setTargetUrl] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(IDLE);

  const matches = useCircleSearch(selected ? "" : query);

  return <section className={styles.card}>
    <h2>認領社團</h2>
    <p>先找到你的社團，再選一個已登錄在場刊裡、且你能公開發文的連結作為驗證方式。找不到可用連結時，送出後由管理者人工核對。</p>

    <label htmlFor="portal-search">社團名稱</label>
    <input id="portal-search" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder="輸入兩個字以上" />
    {matches.length > 0 && !selected && <ul className={styles.matchList}>
      {matches.map((match) => <li key={match.id}>
        <button type="button" onClick={() => { setSelected(match); setQuery(match.name); }}>
          <b>{match.name}</b><small>{match.linkCount} 個已登錄連結</small>
        </button>
      </li>)}
    </ul>}

    {selected && <>
      <label htmlFor="portal-target">驗證用連結（選填）</label>
      <select id="portal-target" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)}>
        <option value="">不使用自動驗證，改由人工審核</option>
        {selected.links.map((link) => <option key={link.url} value={link.url}>{link.provider}：{link.url}</option>)}
      </select>

      <label htmlFor="portal-evidence">佐證連結（人工審核用，選填）</label>
      <input id="portal-evidence" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://…（含驗證碼的公開貼文）" />

      <label htmlFor="portal-note">補充說明（選填）</label>
      <textarea id="portal-note" rows={2} value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} />

      <button type="button" disabled={status.kind === "busy"} onClick={() => {
        setStatus({ kind: "busy", message: "送出中…" });
        void createClaim({
          circleId: selected.id,
          ...(targetUrl ? { targetUrl } : {}),
          ...(evidenceUrl ? { evidenceUrl } : {}),
          ...(evidenceNote ? { evidenceNote } : {}),
        })
          .then((result) => {
            setChallenge(result.challenge);
            setStatus({
              kind: "ok",
              message: result.status === "verified" ? "已自動通過驗證。"
                : result.challenge ? "已建立認領。請把下方驗證碼公開貼在該連結頁面，再回到「我的社團」按重新驗證。"
                  : "已送出，等待管理者人工核對。",
            });
            onCreated();
          })
          .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
      }}>送出認領</button>
    </>}

    {challenge && <p className={styles.challenge}><span>驗證碼</span><code>{challenge}</code></p>}
    {status.kind !== "idle" && status.kind !== "busy" && <p className={status.kind === "error" ? styles.error : styles.notice}>{status.message}</p>}
  </section>;
}

function CircleEditor({ claim }: { claim: ClaimSummary }) {
  const [fields, setFields] = useState<CircleOverrideFields>({});
  const [status, setStatus] = useState<Status>(IDLE);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void readMyOverride(claim.circleId).then((result) => setFields(result.fields ?? {})).catch(() => setFields({}));
  }, [claim.circleId]);

  const setList = (key: (typeof LIST_FIELDS)[number]["key"], value: string) => {
    const items = value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
    setFields((current) => ({ ...current, [key]: items }));
  };

  return <section className={styles.card}>
    <h2>編輯：{claim.circleName}</h2>
    <p>販售資訊、連結與作品標籤會即時生效。社團名稱與筆名需經審核，請改用下方說明聯絡管理者。</p>

    <label htmlFor={`sale-${claim.circleId}`}>販售資訊（最多 {OVERRIDE_LIMITS.saleInfo} 字）</label>
    <textarea
      id={`sale-${claim.circleId}`} rows={4} maxLength={OVERRIDE_LIMITS.saleInfo}
      value={fields.saleInfo ?? ""}
      onChange={(event) => setFields((current) => ({ ...current, saleInfo: event.target.value }))}
    />

    {LIST_FIELDS.map(({ key, label }) => <div key={key}>
      <label htmlFor={`${key}-${claim.circleId}`}>{label}（以逗號分隔，最多 {OVERRIDE_LIMITS.listItems} 項）</label>
      <input id={`${key}-${claim.circleId}`} value={(fields[key] ?? []).join("、")} onChange={(event) => setList(key, event.target.value)} />
    </div>)}

    <button type="button" disabled={status.kind === "busy"} onClick={() => {
      setStatus({ kind: "busy", message: "儲存中…" });
      // Drop empty values so an untouched field keeps inheriting the catalog.
      const payload = Object.fromEntries(Object.entries(fields).filter(([, value]) =>
        Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : !!value));
      void saveOverride(claim.circleId, payload)
        .then(() => setStatus({ kind: "ok", message: "已儲存，公開頁面會在一分鐘內更新。" }))
        .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
    }}>儲存</button>

    {status.kind !== "idle" && status.kind !== "busy" && <p className={status.kind === "error" ? styles.error : styles.notice}>{status.message}</p>}
  </section>;
}

function AdminPanel() {
  const [pending, setPending] = useState<PendingClaim[]>([]);
  const [status, setStatus] = useState<Status>(IDLE);
  const [takedownId, setTakedownId] = useState("");
  const [reason, setReason] = useState("");

  const refresh = useCallback(() => {
    void listPendingClaims()
      .then((result) => setPending(result.claims))
      .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
  }, []);

  useEffect(refresh, [refresh]);

  return <section className={`${styles.card} ${styles.admin}`}>
    <h2>管理：待審認領</h2>
    {pending.length === 0 ? <p>目前沒有待審項目。</p> : <ul className={styles.claimList}>
      {pending.map((claim) => <li key={claim.id}>
        <div>
          <b>{claim.circleName}</b>
          <small>{claim.circleId}</small>
          {claim.evidenceUrl && <a href={claim.evidenceUrl} target="_blank" rel="noreferrer">佐證連結</a>}
          {claim.evidenceNote && <small>{claim.evidenceNote}</small>}
        </div>
        <button type="button" onClick={() => void decideClaim(claim.id, "approve").then(refresh).catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }))}>核准</button>
        <button type="button" onClick={() => void decideClaim(claim.id, "reject").then(refresh).catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }))}>婉拒</button>
      </li>)}
    </ul>}

    <h2>撤下社團補充資料</h2>
    <label htmlFor="takedown-circle">社團 ID</label>
    <input id="takedown-circle" value={takedownId} onChange={(event) => setTakedownId(event.target.value)} placeholder="ff47-…" />
    <label htmlFor="takedown-reason">原因（會寫入稽核記錄）</label>
    <input id="takedown-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
    <button type="button" onClick={() => {
      void takedownOverride(takedownId, reason)
        .then(() => { setStatus({ kind: "ok", message: "已撤下。" }); setTakedownId(""); setReason(""); })
        .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
    }}>撤下</button>

    {status.kind !== "idle" && <p className={status.kind === "error" ? styles.error : styles.notice}>{status.message}</p>}
  </section>;
}
