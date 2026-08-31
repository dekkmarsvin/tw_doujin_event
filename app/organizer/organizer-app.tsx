"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  PortalError,
  readSession,
  readTurnstileSitekey,
  requestLoginLink,
  signOut,
  verifyLoginToken,
  type PortalSession,
} from "../circle-editor-client";
import {
  createOrganizerEvent,
  createOrganizerMap,
  listOrganizerEvents,
  listOrganizerMaps,
  manageOrganizerEditor,
  manageOrganizerOwner,
  previewOrganizerEvent,
  putOrganizerImport,
  readOrganizerEvent,
  readOrganizerMap,
  reviewOrganizerEvent,
  retryOrganizerPublication,
  saveOrganizerEvent,
  saveOrganizerMap,
  submitOrganizerEvent,
  validateOrganizerEvent,
  type OrganizerEventDetail,
  type OrganizerEventSummary,
  type OrganizerMapDetail,
  type OrganizerMapSummary,
  type OrganizerReaderPreview,
} from "../organizer-client";
import {
  buildOrganizerImportMetadata,
  prepareOrganizerImport,
  type OrganizerImportFieldMapping,
  type OrganizerImportMapping,
  type OrganizerNormalizedImportRow,
} from "../organizer-import";
import type { OrganizerEventDraft, OrganizerValidationIssue } from "../organizer-event";
import { readOrganizerWorkbook, type OrganizerWorkbookSheet } from "../organizer-workbook";
import { TurnstileWidget } from "../circle-portal/turnstile-widget";
import AccessibleEventMapRenderer from "../accessible-event-map-renderer";
import { createBlankEventMapLayout, type EventMapLayout } from "../event-map";
import MapLayoutEditor from "../map-layout-editor";
import { hasMapTemplateRecognizer, recognizeMapTemplate } from "../map-template-registry";
import styles from "./organizer.module.css";

type Notice = { kind: "idle" | "busy" | "ok" | "error"; message: string };
const IDLE: Notice = { kind: "idle", message: "" };
const STEP_NAMES = ["活動", "場館與展區", "攤位匯入", "地圖", "驗證與預覽", "送審與發布"] as const;
const STATUS_LABEL: Record<OrganizerEventSummary["status"], string> = {
  draft: "草稿",
  changes_requested: "要求修改",
  submitted: "審閱中",
  approved: "已核准",
  publishing: "發布中",
  published: "已發布",
  failed: "發布失敗",
};

function message(error: unknown) {
  return error instanceof PortalError || error instanceof Error ? error.message : "操作失敗，請稍後再試。";
}

function takeLoginToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("login");
  if (!token) return null;
  url.searchParams.delete("login");
  window.history.replaceState(null, "", url);
  return token;
}

function useDesktopViewport() {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 1040px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1040px)");
    const update = () => setIsDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

export default function OrganizerApp() {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<Notice>(IDLE);
  const isDesktop = useDesktopViewport();

  useEffect(() => {
    const token = takeLoginToken();
    void (token ? verifyLoginToken(token) : readSession())
      .then((current) => {
        if (!current.isAdmin && !current.hasOrganizerAccess) throw new PortalError("此帳號沒有活動工作區權限。", 403);
        setSession(current);
      })
      .catch((error: unknown) => {
        setSession(null);
        if (token) setNotice({ kind: "error", message: message(error) });
      })
      .finally(() => setReady(true));
  }, []);

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>場刊 Map</span><h1>主辦單位工作區</h1></div>
      {session && <div className={styles.identity}>
        <span>{session.email}{session.isAdmin ? "・全域管理者" : ""}</span>
        <button type="button" className={styles.ghost} onClick={() => void signOut().finally(() => setSession(null))}>登出</button>
      </div>}
    </header>
    {notice.kind !== "idle" && <p role="status" className={notice.kind === "error" ? styles.error : styles.notice}>{notice.message}</p>}
    {!ready ? <main className={styles.centerCard}><p>載入工作區…</p></main>
      : !session ? <OrganizerSignIn />
        : isDesktop ? <OrganizerWorkspace session={session} /> : <NarrowScreenBlocker onSignedOut={() => setSession(null)} />}
  </div>;
}

function NarrowScreenBlocker({ onSignedOut }: { onSignedOut: () => void }) {
  return <main className={styles.centerCard}>
    <span className={styles.blockerIcon} aria-hidden="true">↔</span>
    <h2>請改用桌機</h2>
    <p>活動資料與地圖編輯需要至少 1040px 的畫面寬度。此裝置不會載入任何編輯控制。</p>
    <button type="button" className={styles.ghost} onClick={() => void signOut().finally(onSignedOut)}>登出</button>
  </main>;
}

function OrganizerSignIn() {
  const [email, setEmail] = useState("");
  const [sitekey, setSitekey] = useState<string | null>(null);
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState<Notice>(IDLE);
  useEffect(() => { void readTurnstileSitekey().then(setSitekey).catch((error) => setNotice({ kind: "error", message: message(error) })); }, []);
  const unavailable = useCallback(() => setNotice({ kind: "error", message: "真人驗證元件載入失敗，請檢查網路後重新整理。" }), []);

  return <main className={styles.centerCard}>
    <span className={styles.eyebrow}>Invitation only</span>
    <h2>Organizer 登入</h2>
    <p>使用受邀的 email 取得 15 分鐘內有效的一次性登入連結。</p>
    <form className={styles.stack} onSubmit={(event) => {
      event.preventDefault();
      if (!humanToken) return;
      setNotice({ kind: "busy", message: "寄送中…" });
      void requestLoginLink(email, humanToken, "organizer")
        .then(() => setNotice({ kind: "ok", message: "若帳號可使用，登入連結已寄出。" }))
        .catch((error: unknown) => setNotice({ kind: "error", message: message(error) }))
        .finally(() => { setHumanToken(null); setGeneration((value) => value + 1); });
    }}>
      <label htmlFor="organizer-email">Email</label>
      <input id="organizer-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      {sitekey && <TurnstileWidget key={generation} sitekey={sitekey} onToken={setHumanToken} onUnavailable={unavailable} />}
      <button type="submit" disabled={!humanToken || notice.kind === "busy"}>寄出登入連結</button>
    </form>
    <p className={styles.finePrint}>登入前請閱讀<a href="/privacy">隱私權與資料使用告知</a>。此頁不會出現在公開 Reader 導覽。</p>
    {notice.kind !== "idle" && <p role="status" className={notice.kind === "error" ? styles.error : styles.notice}>{notice.message}</p>}
  </main>;
}

function OrganizerWorkspace({ session }: { session: PortalSession }) {
  const [events, setEvents] = useState<OrganizerEventSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrganizerEventDetail | null>(null);
  const [step, setStep] = useState(0);
  const [notice, setNotice] = useState<Notice>(IDLE);

  const reloadList = useCallback(async () => {
    const next = (await listOrganizerEvents()).events;
    setEvents(next);
    setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null);
  }, []);
  const reloadDetail = useCallback(async (candidateId: string) => setDetail(await readOrganizerEvent(candidateId)), []);
  useEffect(() => { queueMicrotask(() => { void reloadList().catch((error) => setNotice({ kind: "error", message: message(error) })); }); }, [reloadList]);
  useEffect(() => { queueMicrotask(() => { if (selectedId) void reloadDetail(selectedId).catch((error) => setNotice({ kind: "error", message: message(error) })); else setDetail(null); }); }, [reloadDetail, selectedId]);

  const refresh = useCallback(async () => {
    await reloadList();
    if (selectedId) await reloadDetail(selectedId);
  }, [reloadDetail, reloadList, selectedId]);

  return <main className={styles.shell}>
    <aside className={styles.sidebar}>
      <div className={styles.sidebarTitle}><span className={styles.eyebrow}>Activities</span><h2>活動入口</h2></div>
      {session.isAdmin && <CreateEntry onCreated={async (id) => { await reloadList(); setSelectedId(id); }} />}
      <nav aria-label="活動列表" className={styles.eventList}>
        {events.map((item) => <button type="button" key={item.id} className={item.id === selectedId ? styles.eventActive : styles.eventButton} onClick={() => { setSelectedId(item.id); setStep(0); }}>
          <span>{item.tentativeName}</span><small>{STATUS_LABEL[item.status]}・v{item.version}</small>
        </button>)}
        {events.length === 0 && <p className={styles.muted}>目前沒有可管理的活動。</p>}
      </nav>
    </aside>
    <section className={styles.workspace}>
      {notice.kind !== "idle" && <p role="status" className={notice.kind === "error" ? styles.error : styles.notice}>{notice.message}</p>}
      {!detail ? <div className={styles.empty}><h2>選擇活動入口</h2><p>從左側開啟活動，開始準備可送審的版本。</p></div>
        : <>
          <div className={styles.workspaceHead}>
            <div><span className={styles.eyebrow}>{detail.event.role}・{STATUS_LABEL[detail.event.status]}</span><h2>{detail.draft.event.name || detail.event.tentativeName}</h2></div>
            <span className={styles.version}>Revision {detail.event.version}</span>
          </div>
          <ol className={styles.steps}>{STEP_NAMES.map((name, index) => <li key={name}><button type="button" aria-current={index === step ? "step" : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{name}</button></li>)}</ol>
          <StepContent key={`${detail.event.id}:${detail.event.version}:${step}`} session={session} detail={detail} step={step} onChanged={refresh} setNotice={setNotice} />
        </>}
    </section>
  </main>;
}

function CreateEntry({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<Notice>(IDLE);
  if (!open) return <button type="button" className={styles.createButton} onClick={() => setOpen(true)}>＋ 建立空白活動入口</button>;
  return <form className={styles.createForm} onSubmit={(event) => {
    event.preventDefault();
    setNotice({ kind: "busy", message: "建立中…" });
    void createOrganizerEvent(name, email).then(async ({ candidateId }) => {
      setName(""); setEmail(""); setOpen(false); await onCreated(candidateId);
    }).catch((error) => setNotice({ kind: "error", message: message(error) }));
  }}>
    <label>暫定名稱<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label>Owner email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <div className={styles.row}><button type="submit">建立並邀請</button><button type="button" className={styles.ghost} onClick={() => setOpen(false)}>取消</button></div>
    {notice.kind === "error" && <p className={styles.error}>{notice.message}</p>}
  </form>;
}

function StepContent({ session, detail, step, onChanged, setNotice }: {
  session: PortalSession;
  detail: OrganizerEventDetail;
  step: number;
  onChanged: () => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  if (step === 0 || step === 1) return <DraftForm detail={detail} section={step === 0 ? "event" : "venue"} onChanged={onChanged} setNotice={setNotice} />;
  if (step === 2) return <ImportPanel detail={detail} onChanged={onChanged} setNotice={setNotice} />;
  if (step === 3) return <OrganizerMapPanel detail={detail} onChanged={onChanged} setNotice={setNotice} />;
  if (step === 4) return <ValidationPanel detail={detail} setNotice={setNotice} />;
  return <ReviewPanel session={session} detail={detail} onChanged={onChanged} setNotice={setNotice} />;
}

function imageDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("無法讀取配置圖。"));
    reader.readAsDataURL(file);
  });
}

function loadOrganizerMapImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("配置圖格式無法解析。"));
    image.src = source;
  });
}

function OrganizerMapPanel({ detail, onChanged, setNotice }: {
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const [maps, setMaps] = useState<OrganizerMapSummary[]>([]);
  const [selected, setSelected] = useState<OrganizerMapDetail | null>(null);
  const [periodKey, setPeriodKey] = useState(detail.draft.event.days[0]?.id ?? "");
  const [venueSpaceId, setVenueSpaceId] = useState(detail.draft.venue.assignments[0]?.venueSpaceId ?? "");
  const [layout, setLayout] = useState<EventMapLayout | null>(null);
  const [background, setBackground] = useState("");
  const editable = detail.event.status === "draft" || detail.event.status === "changes_requested";
  const assignment = detail.draft.venue.assignments.find((item) => item.venueSpaceId === venueSpaceId);
  const reload = useCallback(async () => setMaps((await listOrganizerMaps(detail.event.id)).maps), [detail.event.id]);
  useEffect(() => { queueMicrotask(() => { void reload().catch((error) => setNotice({ kind: "error", message: message(error) })); }); }, [reload, setNotice]);

  const open = async (map: OrganizerMapSummary) => {
    const next = (await readOrganizerMap(detail.event.id, map.id)).map;
    setSelected(next); setPeriodKey(next.periodKey); setVenueSpaceId(next.venueSpaceId);
    setLayout(next.layout); setBackground("");
  };
  const startBlank = () => {
    if (!assignment) return;
    setSelected(null); setBackground("");
    setLayout(createBlankEventMapLayout(assignment.mapTemplate, 1600, 1000));
  };
  const runFile = async (file: File) => {
    if (!assignment) throw new Error("請先選擇 venue-space。");
    if (file.size > 4 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error("配置圖需為 JPG、PNG 或 WebP，且不可超過 4MB。");
    }
    const source = await imageDataUrl(file);
    const image = await loadOrganizerMapImage(source);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("瀏覽器無法建立圖片分析畫布。");
    context.drawImage(image, 0, 0);
    const next = hasMapTemplateRecognizer(assignment.mapTemplate)
      ? recognizeMapTemplate(assignment.mapTemplate, context.getImageData(0, 0, canvas.width, canvas.height)).layout
      : createBlankEventMapLayout(assignment.mapTemplate, canvas.width, canvas.height);
    setSelected(null); setBackground(source); setLayout(next);
  };

  return <section className={`${styles.panel} ${styles.mapPanel}`}>
    <div className={styles.panelHead}><div><h3>各日 × venue-space 地圖</h3><p>下方直接使用共用 MapLayoutEditor；保存 scope 為 candidateId、periodKey 與 venueSpaceId。</p></div><span className={styles.version}>{maps.length} maps</span></div>
    <div className={styles.mapToolbar}>
      <label>活動日<select value={periodKey} disabled={!!selected} onChange={(event) => setPeriodKey(event.target.value)}>{detail.draft.event.days.map((day) => <option value={day.id} key={day.id}>{day.label}</option>)}</select></label>
      <label>Venue-space<select value={venueSpaceId} disabled={!!selected} onChange={(event) => { setVenueSpaceId(event.target.value); setLayout(null); }}>{detail.draft.venue.assignments.map((item) => <option value={item.venueSpaceId} key={item.venueSpaceId}>{item.venueSpaceId}</option>)}</select></label>
      <button type="button" className={styles.ghost} disabled={!editable || !assignment} onClick={startBlank}>空白畫布</button>
      <label className={styles.fileButton}>上傳配置圖描摹<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!editable || !assignment} onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setNotice({ kind: "busy", message: "正在本機辨識配置圖…" });
        void runFile(file).then(() => setNotice({ kind: "ok", message: hasMapTemplateRecognizer(assignment?.mapTemplate ?? "") ? "已套用註冊 template 辨識結果。" : "此 template 無辨識器，已建立描摹底圖。" })).catch((error) => setNotice({ kind: "error", message: message(error) }));
      }} /></label>
      <label>從同 venue-space 複製<select value="" onChange={(event) => {
        const map = maps.find((item) => item.id === event.target.value);
        if (!map) return;
        void readOrganizerMap(detail.event.id, map.id).then(({ map: source }) => {
          setSelected(null); setPeriodKey(periodKey); setLayout(structuredClone(source.layout)); setBackground("");
        }).catch((error) => setNotice({ kind: "error", message: message(error) }));
      }}><option value="">選擇既有地圖</option>{maps.filter((item) => item.venueSpaceId === venueSpaceId && item.periodKey !== periodKey).map((item) => <option value={item.id} key={item.id}>{item.periodKey}・rev {item.mapRevision}</option>)}</select></label>
    </div>
    <div className={styles.mapTabs}>{maps.map((map) => <button type="button" className={selected?.id === map.id ? styles.eventActive : styles.ghost} key={map.id} onClick={() => void open(map).catch((error) => setNotice({ kind: "error", message: message(error) }))}>{map.periodKey}・{map.venueSpaceId}<small>rev {map.mapRevision}</small></button>)}</div>
    {layout ? <>
      <MapLayoutEditor layout={layout} backgroundImageUrl={background || undefined} onChange={setLayout} />
      <div className={styles.row}><button type="button" disabled={!editable} onClick={() => {
        setNotice({ kind: "busy", message: "儲存地圖 revision…" });
        const action = selected
          ? saveOrganizerMap(detail.event.id, selected.id, { expectedVersion: detail.event.version, expectedMapRevision: selected.mapRevision, layout })
          : createOrganizerMap(detail.event.id, { expectedVersion: detail.event.version, periodKey, venueSpaceId, layout });
        void action.then(async () => { setNotice({ kind: "ok", message: "地圖已保存為私人 immutable revision。" }); setLayout(null); setSelected(null); await onChanged(); await reload(); })
          .catch((error) => setNotice({ kind: "error", message: message(error) }));
      }}>{selected ? `儲存 map revision ${selected.mapRevision + 1}` : "建立此 scope 的地圖"}</button><button type="button" className={styles.ghost} onClick={() => { setLayout(null); setSelected(null); setBackground(""); }}>關閉編輯器</button></div>
    </> : <div className={styles.placeholder}>選擇既有地圖，或從空白畫布、同空間地圖、配置圖開始。</div>}
  </section>;
}

type MappingChoice = { column: number | null; fixed: string };

function ImportPanel({ detail, onChanged, setNotice }: {
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const [fileName, setFileName] = useState("");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [sheets, setSheets] = useState<OrganizerWorkbookSheet[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [sourceDescription, setSourceDescription] = useState(detail.draft.officialSource.label);
  const onlySpace = detail.draft.venue.assignments.length === 1 ? detail.draft.venue.assignments[0] : null;
  const onlyDay = detail.draft.event.days.length === 1 ? detail.draft.event.days[0] : null;
  const [day, setDay] = useState<MappingChoice>({ column: null, fixed: onlyDay?.id ?? "" });
  const [venueSpace, setVenueSpace] = useState<MappingChoice>({ column: null, fixed: onlySpace?.venueSpaceId ?? "" });
  const [area, setArea] = useState<MappingChoice>({ column: null, fixed: onlySpace?.areaIds.length === 1 ? onlySpace.areaIds[0] : "" });
  const [boothColumn, setBoothColumn] = useState<number | null>(null);
  const [circleColumn, setCircleColumn] = useState<number | null>(null);
  const [stableColumn, setStableColumn] = useState<number | null>(null);
  const [prepared, setPrepared] = useState<null | {
    rows: OrganizerNormalizedImportRow[];
    issues: OrganizerValidationIssue[];
    metadata: Awaited<ReturnType<typeof buildOrganizerImportMetadata>>;
    mapping: OrganizerImportMapping;
  }>(null);
  const sheet = sheets.find((item) => item.name === sheetName) ?? null;
  const header = sheet?.rows[headerRow - 1]?.cells ?? [];
  const editable = detail.event.status === "draft" || detail.event.status === "changes_requested";

  const fieldMapping = (choice: MappingChoice, values?: Record<string, string>): OrganizerImportFieldMapping =>
    choice.column === null ? { fixed: choice.fixed } : { column: choice.column, ...(values ? { values } : {}) };
  const select = (label: string, value: MappingChoice, setValue: (value: MappingChoice) => void, fixedHint: string) => <label>{label}
    <select value={value.column === null ? "fixed" : String(value.column)} onChange={(event) => setValue(event.target.value === "fixed" ? { ...value, column: null } : { ...value, column: Number(event.target.value) })}>
      <option value="fixed">固定值</option>
      {header.map((name, index) => <option value={index} key={index}>{index + 1}. {String(name || "（空白）")}</option>)}
    </select>
    {value.column === null && <input aria-label={`${label}固定值`} placeholder={fixedHint} value={value.fixed} onChange={(event) => setValue({ ...value, fixed: event.target.value })} />}
  </label>;

  return <section className={styles.panel}>
    <div className={styles.panelHead}><div><h3>CSV／XLSX 攤位及社團匯入</h3><p>檔案只在此瀏覽器解析與 SHA-256 雜湊；API 只接收你確認的欄位與正規化資料列。</p></div>{detail.import && <span className={styles.version}>{detail.import.rows.length} rows・{detail.import.source.fileName}</span>}</div>
    <div className={styles.importGrid}>
      <label>來源檔案<input type="file" disabled={!editable} accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setPrepared(null);
        setNotice({ kind: "busy", message: "正在本機解析檔案…" });
        void readOrganizerWorkbook(file).then((workbook) => {
          setFileName(file.name); setBytes(workbook.bytes); setSheets(workbook.sheets);
          setSheetName(workbook.sheets[0]?.name ?? ""); setHeaderRow(1);
          setNotice({ kind: "ok", message: `已在瀏覽器解析 ${workbook.sheets.length} 個 worksheet；尚未上傳。` });
        }).catch((error) => setNotice({ kind: "error", message: message(error) }));
      }} /></label>
      <label>Worksheet<select disabled={sheets.length < 2} value={sheetName} onChange={(event) => { setSheetName(event.target.value); setPrepared(null); }}><option value="">尚未選擇</option>{sheets.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>
      <label>表頭列<input type="number" min={1} max={sheet?.rows.length ?? 1} value={headerRow} onChange={(event) => { setHeaderRow(Number(event.target.value)); setPrepared(null); }} /></label>
      <label>來源說明<input value={sourceDescription} onChange={(event) => setSourceDescription(event.target.value)} /></label>
    </div>
    {sheet && <>
      <div className={styles.mappingGrid}>
        {select("day", day, setDay, "活動日 ID")}
        {select("venue-space", venueSpace, setVenueSpace, "venue-space ID")}
        {select("area", area, setArea, "area ID")}
        <ColumnSelect label="booth code" value={boothColumn} header={header} required onChange={setBoothColumn} />
        <ColumnSelect label="circle name" value={circleColumn} header={header} required onChange={setCircleColumn} />
        <ColumnSelect label="Organizer stable key（選填）" value={stableColumn} header={header} onChange={setStableColumn} />
      </div>
      <div className={styles.row}>
        <button type="button" disabled={!bytes || boothColumn === null || circleColumn === null} onClick={() => {
          if (!bytes || !sheet || boothColumn === null || circleColumn === null) return;
          const dayValues = Object.fromEntries(detail.draft.event.days.flatMap((item) => [[item.id, item.id], [item.label, item.id]]));
          const mapping: OrganizerImportMapping = {
            day: fieldMapping(day, day.column === null ? undefined : dayValues),
            venueSpace: fieldMapping(venueSpace), area: fieldMapping(area),
            boothCode: { column: boothColumn }, circleName: { column: circleColumn },
            ...(stableColumn === null ? {} : { stableKey: { column: stableColumn } }),
          };
          // prepareOrganizerImport rejects an unusable header row by throwing.
          // Unhandled that reads as a dead button on the organizer's first
          // task, so the refusal is surfaced like every other failure here.
          let result;
          try {
            result = prepareOrganizerImport({ rows: sheet.rows, headerRow, mapping });
          } catch (error) {
            setNotice({ kind: "error", message: message(error) });
            return;
          }
          void buildOrganizerImportMetadata({ bytes, fileName, worksheet: sheetName === "CSV" ? null : sheetName, sourceDescription })
            .then((metadata) => setPrepared({ ...result, metadata, mapping }))
            .catch((error) => setNotice({ kind: "error", message: message(error) }));
        }}>建立 mapping 預覽</button>
        <button type="button" className={styles.ghost} disabled={!prepared || prepared.rows.length === 0 || prepared.issues.some((issue) => issue.severity === "error")} onClick={() => {
          if (!prepared) return;
          setNotice({ kind: "busy", message: "儲存正規化匯入資料…" });
          void putOrganizerImport(detail.event.id, {
            expectedVersion: detail.event.version,
            source: { ...prepared.metadata, mapping: prepared.mapping }, rows: prepared.rows,
          }).then(async () => { setNotice({ kind: "ok", message: "匯入資料已建立新 revision；原始檔未上傳。" }); await onChanged(); })
            .catch((error) => setNotice({ kind: "error", message: message(error) }));
        }}>確認並儲存 {prepared?.rows.length ?? 0} 列</button>
      </div>
      {prepared && <div className={styles.importPreview}>
        <div className={styles.validationSummary}><b>{prepared.rows.length} valid rows</b><span>{prepared.issues.length} issues</span></div>
        {prepared.issues.map((issue, index) => <p key={`${issue.code}-${index}`} className={styles.issueError}>來源列 {issue.row}・{issue.message}</p>)}
        <table><thead><tr><th>來源列</th><th>day</th><th>space / area</th><th>booth</th><th>circle</th><th>identity evidence</th></tr></thead><tbody>{prepared.rows.slice(0, 100).map((row) => <tr key={`${row.sourceRow}-${row.boothCode}`}><td>{row.sourceRow}</td><td>{row.dayId}</td><td>{row.venueSpaceId} / {row.areaId}</td><td>{row.boothCode}</td><td>{row.circleName}</td><td>{row.identityGroup ?? "未合併"}</td></tr>)}</tbody></table>
        {prepared.rows.length > 100 && <p>預覽前 100 列；儲存時會包含全部確認列。</p>}
      </div>}
    </>}
  </section>;
}

function ColumnSelect({ label, value, header, required = false, onChange }: {
  label: string; value: number | null; header: readonly unknown[]; required?: boolean; onChange: (value: number | null) => void;
}) {
  return <label>{label}<select required={required} value={value === null ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}><option value="">尚未選擇</option>{header.map((name, index) => <option value={index} key={index}>{index + 1}. {String(name || "（空白）")}</option>)}</select></label>;
}

function DraftForm({ detail, section, onChanged, setNotice }: {
  detail: OrganizerEventDetail;
  section: "event" | "venue";
  onChanged: () => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const [draft, setDraft] = useState(detail.draft);
  const editable = detail.event.status === "draft" || detail.event.status === "changes_requested";
  const update = (mutate: (current: OrganizerEventDraft) => OrganizerEventDraft) => setDraft((current) => mutate(structuredClone(current)));
  return <section className={styles.panel}>
    <div className={styles.panelHead}><div><h3>{section === "event" ? "活動基本資料" : "場館、空間與展區"}</h3><p>所有儲存都以 revision {detail.event.version} 為預期版本。</p></div><button type="button" disabled={!editable} onClick={() => {
      setNotice({ kind: "busy", message: "儲存中…" });
      void saveOrganizerEvent(detail.event.id, detail.event.version, draft)
        .then(async () => { setNotice({ kind: "ok", message: "已建立新的 immutable revision。" }); await onChanged(); })
        .catch((error) => setNotice({ kind: "error", message: message(error) }));
    }}>儲存 revision</button></div>
    {section === "event" ? <div className={styles.formGrid}>
      <label>活動名稱<input disabled={!editable} value={draft.event.name} onChange={(event) => update((next) => { next.event.name = event.target.value; return next; })} /></label>
      <label>eventId<input disabled={!editable || detail.event.eventIdLocked} placeholder="pf45-rf14" value={draft.event.id ?? ""} onChange={(event) => update((next) => { next.event.id = event.target.value || null; return next; })} /><small>{detail.event.eventIdLocked ? "首次送審後已鎖定" : "小寫英數字與連字號"}</small></label>
      <label>官方來源說明<input disabled={!editable} value={draft.officialSource.label} onChange={(event) => update((next) => { next.officialSource.label = event.target.value; return next; })} /></label>
      <label>官方來源網址<input disabled={!editable} type="url" placeholder="https://" value={draft.officialSource.url ?? ""} onChange={(event) => update((next) => { next.officialSource.url = event.target.value || null; return next; })} /></label>
      <div className={styles.full}><div className={styles.panelHead}><h4>活動日</h4><button type="button" className={styles.ghost} disabled={!editable} onClick={() => update((next) => { next.event.days.push({ id: String(next.event.days.length + 1), label: `第 ${next.event.days.length + 1} 日`, date: "" }); return next; })}>＋ 新增日期</button></div>
        {draft.event.days.map((day, index) => <div className={styles.inlineFields} key={`${index}-${day.id}`}>
          <input disabled={!editable} aria-label={`第 ${index + 1} 日 id`} value={day.id} onChange={(event) => update((next) => { next.event.days[index].id = event.target.value; return next; })} />
          <input disabled={!editable} aria-label={`第 ${index + 1} 日名稱`} value={day.label} onChange={(event) => update((next) => { next.event.days[index].label = event.target.value; return next; })} />
          <input disabled={!editable} aria-label={`第 ${index + 1} 日日期`} type="date" value={day.date} onChange={(event) => update((next) => { next.event.days[index].date = event.target.value; return next; })} />
          <button type="button" className={styles.dangerText} disabled={!editable} onClick={() => update((next) => { next.event.days.splice(index, 1); return next; })}>移除</button>
        </div>)}</div>
    </div> : <div>
      <button type="button" className={styles.ghost} disabled={!editable} onClick={() => update((next) => { next.venue.assignments.push({ venueId: "", venueSpaceId: "", areaIds: [], mapTemplate: "TAIWAN_GENERIC_V1" }); return next; })}>＋ 新增 venue-space</button>
      {draft.venue.assignments.map((assignment, index) => <div className={styles.venueCard} key={index}>
        <label>Venue ID<input disabled={!editable} value={assignment.venueId} onChange={(event) => update((next) => { next.venue.assignments[index].venueId = event.target.value; return next; })} /></label>
        <label>Venue-space ID<input disabled={!editable} value={assignment.venueSpaceId} onChange={(event) => update((next) => { next.venue.assignments[index].venueSpaceId = event.target.value; return next; })} /></label>
        <label>Area IDs（逗號分隔）<input disabled={!editable} value={assignment.areaIds.join(", ")} onChange={(event) => update((next) => { next.venue.assignments[index].areaIds = event.target.value.split(",").map((value) => value.trim()).filter(Boolean); return next; })} /></label>
        <label>Map template<input disabled={!editable} value={assignment.mapTemplate} onChange={(event) => update((next) => { next.venue.assignments[index].mapTemplate = event.target.value; return next; })} /></label>
        <button type="button" className={styles.dangerText} disabled={!editable} onClick={() => update((next) => { next.venue.assignments.splice(index, 1); return next; })}>移除此空間</button>
      </div>)}
    </div>}
  </section>;
}

function ValidationPanel({ detail, setNotice }: { detail: OrganizerEventDetail; setNotice: (notice: Notice) => void }) {
  const [issues, setIssues] = useState<OrganizerValidationIssue[] | null>(null);
  const [preview, setPreview] = useState<OrganizerReaderPreview | null>(null);
  const grouped = useMemo(() => issues ? { errors: issues.filter((issue) => issue.severity === "error"), warnings: issues.filter((issue) => issue.severity === "warning") } : null, [issues]);
  return <section className={styles.panel}>
    <div className={styles.panelHead}><div><h3>Validation 與 Reader 預覽</h3><p>候選資料只在已登入的預覽 API 中組裝，不會進入公開 manifest。</p></div><div className={styles.row}>
      <button type="button" onClick={() => void validateOrganizerEvent(detail.event.id).then((result) => setIssues(result.issues)).catch((error) => setNotice({ kind: "error", message: message(error) }))}>執行驗證</button>
      <button type="button" className={styles.ghost} onClick={() => void previewOrganizerEvent(detail.event.id).then((result) => { setIssues(result.issues); setPreview(result.preview); }).catch((error) => setNotice({ kind: "error", message: message(error) }))}>建立預覽</button>
    </div></div>
    {grouped && <div className={styles.validationSummary}><b>{grouped.errors.length} errors</b><span>{grouped.warnings.length} warnings</span></div>}
    {issues?.map((issue, index) => <p key={`${issue.code}-${index}`} className={issue.severity === "error" ? styles.issueError : styles.issueWarning}><code>{issue.step}/{issue.code}</code> {issue.message}</p>)}
    {preview !== null && <OrganizerReaderPreviewPanel preview={preview} />}
  </section>;
}

function OrganizerReaderPreviewPanel({ preview }: { preview: OrganizerReaderPreview }) {
  const [mapIndex, setMapIndex] = useState(0);
  const selected = preview.maps[mapIndex] ?? null;
  const slots = useMemo(() => selected ? Object.fromEntries(preview.placements
    .filter((row) => row.dayId === selected.periodKey && row.venueSpaceId === selected.venueSpaceId)
    .map((row) => [row.boothCode, { label: row.circleName, ariaLabel: `攤位 ${row.boothCode}，${row.circleName}` }])) : {}, [preview, selected]);
  return <div className={styles.readerPreview}>
    <div className={styles.panelHead}><div><span className={styles.eyebrow}>Authenticated Reader preview</span><h4>{preview.event.name}</h4></div><select aria-label="預覽地圖 scope" value={mapIndex} onChange={(event) => setMapIndex(Number(event.target.value))}>{preview.maps.map((map, index) => <option value={index} key={`${map.periodKey}/${map.venueSpaceId}`}>{map.periodKey}・{map.venueSpaceId}・rev {map.revision}</option>)}</select></div>
    {selected ? <AccessibleEventMapRenderer eventName={`${preview.event.name} 預覽`} layout={selected.layout} slots={slots} onSelect={() => undefined} /> : <p>尚無可預覽的地圖。</p>}
    <details><summary>檢視 preview bundle</summary><pre className={styles.preview}>{JSON.stringify(preview, null, 2)}</pre></details>
  </div>;
}

function ReviewPanel({ session, detail, onChanged, setNotice }: {
  session: PortalSession;
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const [editorEmail, setEditorEmail] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [note, setNote] = useState("");
  const owner = detail.event.role === "owner";
  const act = (promise: Promise<unknown>, success: string) => {
    setNotice({ kind: "busy", message: "處理中…" });
    void promise.then(async () => { setNotice({ kind: "ok", message: success }); await onChanged(); }).catch((error) => setNotice({ kind: "error", message: message(error) }));
  };
  return <section className={styles.panel}>
    <h3>送審、發布狀態與版本</h3>
    <div className={styles.statusBoard}><span>目前狀態</span><strong>{STATUS_LABEL[detail.event.status]}</strong><span>eventId</span><strong>{detail.draft.event.id ?? "尚未設定"}</strong></div>
    {owner && <div className={styles.subpanel}><h4>Editor 協作</h4><form className={styles.row} onSubmit={(event: FormEvent) => { event.preventDefault(); act(manageOrganizerEditor(detail.event.id, editorEmail, "invite"), "Editor 邀請已寄出。"); }}><input type="email" required placeholder="editor@example.com" value={editorEmail} onChange={(event) => setEditorEmail(event.target.value)} /><button type="submit">邀請 Editor</button><button type="button" className={styles.dangerText} disabled={!editorEmail} onClick={() => act(manageOrganizerEditor(detail.event.id, editorEmail, "revoke"), "Editor 權限已撤銷。")}>撤銷此 Editor</button></form></div>}
    {session.isAdmin && <div className={styles.subpanel}><h4>Owner 權限</h4><p>只有全域管理者可增減 Owner；每場活動至少保留一位。</p><form className={styles.row} onSubmit={(event: FormEvent) => { event.preventDefault(); act(manageOrganizerOwner(detail.event.id, ownerEmail, "invite"), "Owner 邀請已寄出。"); }}><input type="email" required placeholder="owner@example.com" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} /><button type="submit">新增 Owner</button><button type="button" className={styles.dangerText} disabled={!ownerEmail} onClick={() => act(manageOrganizerOwner(detail.event.id, ownerEmail, "revoke"), "Owner 權限已撤銷。")}>撤銷此 Owner</button></form></div>}
    {owner && (detail.event.status === "draft" || detail.event.status === "changes_requested") && <div className={styles.subpanel}><h4>送審</h4><p>送審會鎖定 eventId。這是需要 fresh session 的獨立動作。</p><button type="button" onClick={() => act(submitOrganizerEvent(detail.event.id, detail.event.version), "已送交全域管理者審閱。")}>送出 revision {detail.event.version}</button></div>}
    {session.isAdmin && detail.event.status === "submitted" && <div className={styles.subpanel}><h4>全域管理者審閱</h4><p className={styles.warning}>若你也是本 revision 的送審者，核准仍是另一個 fresh-session 動作，系統會記錄 self-approval 警示。</p><textarea placeholder="審閱說明" value={note} onChange={(event) => setNote(event.target.value)} /><div className={styles.row}><button type="button" className={styles.ghost} onClick={() => act(reviewOrganizerEvent(detail.event.id, detail.event.version, "changes_requested", note), "已要求修改。")}>要求修改</button><button type="button" onClick={() => act(reviewOrganizerEvent(detail.event.id, detail.event.version, "approve", note), "已核准；發布能力目前仍受 feature flag 控制。")}>核准 revision</button></div></div>}
    {detail.publication && <div className={styles.subpanel}><h4>發布工作</h4><div className={styles.statusBoard}><span>狀態</span><strong>{detail.publication.status}</strong><span>步驟</span><strong>{detail.publication.step}</strong></div>{detail.publication.error && <p className={styles.warning}>{detail.publication.error}</p>}{session.isAdmin && detail.publication.status === "failed" && <button type="button" onClick={() => act(retryOrganizerPublication(detail.publication!.id), "發布工作已排入重試。")}>從失敗步驟重試</button>}</div>}
    <div className={styles.subpanel}><h4>Immutable revisions</h4><ol className={styles.history}>{detail.revisions.map((revision) => <li key={revision.version}><b>v{revision.version}</b><span>{revision.createdByRole}</span><time>{new Date(revision.createdAt).toLocaleString("zh-TW")}</time></li>)}</ol></div>
  </section>;
}
