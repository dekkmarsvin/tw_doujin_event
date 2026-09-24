import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { PortalError } from "../circle-editor-client";
import { EVENT_ALIAS_MAX_COUNT } from "../event-aliases";
import {
  readOrganizerAmendment, saveOrganizerAmendment,
  type OrganizerAmendmentChange, type OrganizerAmendmentDestination, type OrganizerAmendmentDetail,
  type OrganizerAmendmentImpact, type OrganizerAmendmentSettingsImpact, type OrganizerEventDetail,
} from "../organizer-client";
import styles from "./organizer.module.css";

const KIND_LABEL = { withdrawn: "退出", released: "換手", moved: "移動／重編號", added: "新增" };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "目前無法讀取修正內容。";
const sourcesOf = (change: OrganizerAmendmentChange) => change.kind === "added" ? []
  : change.kind === "moved" ? change.moves.map((move) => move.source) : change.sources;

/** The event as this correction would publish it: the published values with
 * the saved declaration applied. The form edits these and the save sends them
 * whole; the server keeps only what differs from the published event. */
type SettingsForm = { name: string; aliases: string[]; days: Record<string, string> };
function settingsForm(detail: OrganizerAmendmentDetail): SettingsForm {
  const { event } = detail.baseline;
  const dates = new Map((detail.settings?.days ?? []).map((day) => [day.id, day.date]));
  return {
    name: detail.settings?.name ?? event.name,
    aliases: detail.settings?.aliases ?? event.aliases ?? [],
    days: Object.fromEntries(event.days.map((day) => [String(day.id), dates.get(String(day.id)) ?? day.dateLabel])),
  };
}

export function OrganizerAmendmentPanel({ detail, onChanged, onDirtyChange, onSaveReady }: {
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onSaveReady: (save: (() => Promise<boolean>) | null) => void;
}) {
  const [loaded, setLoaded] = useState<OrganizerAmendmentDetail | null>(null);
  const [changes, setChanges] = useState<OrganizerAmendmentChange[]>([]);
  const [settings, setSettings] = useState<SettingsForm | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [formKey, setFormKey] = useState(0);
  const editable = ["draft", "changes_requested"].includes(detail.event.status);
  const changesDirty = loaded !== null && JSON.stringify(changes) !== JSON.stringify(loaded.changes);
  const settingsDirty = loaded !== null && settings !== null && JSON.stringify(settings) !== JSON.stringify(settingsForm(loaded));
  const dirty = changesDirty || settingsDirty || formDirty;
  useEffect(() => {
    let active = true;
    void readOrganizerAmendment(detail.event.id).then((result) => {
      if (active) { setLoaded(result); setChanges(result.changes); setSettings(settingsForm(result)); }
    }).catch((error) => { if (active) setNotice(errorMessage(error)); });
    return () => { active = false; };
  }, [detail.event.id]);
  useEffect(() => {
    onDirtyChange(dirty);
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { onDirtyChange(false); window.removeEventListener("beforeunload", warn); };
  }, [dirty, onDirtyChange]);
  const save = useCallback(async () => {
    if (!loaded || busy || conflict || !editable) return false;
    if (formDirty) { setNotice("請先將目前表單加入修正清單，或取消這筆表單，再儲存。"); return false; }
    setBusy(true); setNotice("");
    try {
      const result = await saveOrganizerAmendment(detail.event.id, loaded.version, changes, settings ? {
        name: settings.name, aliases: settings.aliases,
        days: Object.entries(settings.days).map(([id, date]) => ({ id, date })),
      } : undefined);
      const next = { ...loaded, version: result.version, changes, impact: result.impact,
        settings: result.settings, settingsImpact: result.settingsImpact };
      setLoaded(next);
      setSettings(settingsForm(next));
      onDirtyChange(false);
      setNotice("修正已儲存，請核對下方影響；公開活動尚未改變。");
      await onChanged();
      return true;
    } catch (error) {
      setNotice(errorMessage(error));
      if (error instanceof PortalError && error.status === 409) setConflict(true);
      return false;
    } finally { setBusy(false); }
  }, [loaded, busy, conflict, editable, formDirty, detail.event.id, changes, settings, onDirtyChange, onChanged]);
  useEffect(() => { onSaveReady(save); return () => onSaveReady(null); }, [save, onSaveReady]);
  const resetForm = () => { setEditing(null); setFormDirty(false); setFormKey((key) => key + 1); };
  const reload = async () => {
    setBusy(true);
    try {
      const result = await readOrganizerAmendment(detail.event.id);
      setLoaded(result); setChanges(result.changes); setSettings(settingsForm(result)); setConflict(false); setNotice(""); resetForm();
      await onChanged();
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <section className={styles.panel} aria-label="已發布活動修正">
    <div className={styles.panelHead}><div><h3>已發布活動修正</h3><p>明確宣告要更正的活動設定與名單變動，儲存後核對影響。沒有更正的設定與名單保持原狀。</p></div></div>
    {notice && <p role="alert" className={styles.warning}>{notice}</p>}
    {!loaded ? <><p>正在讀取已發布名單…</p>{notice && <button type="button" onClick={() => void reload()}>重新讀取修正</button>}</> : <>
      <p>來源：第 {loaded.baseline.sourceVersion} 版，{new Date(loaded.baseline.publishedAt).toLocaleString("zh-TW")} 發布。此修正尚未變更公開活動。</p>
      {conflict && <div className={styles.subpanel}><p>其他人已修改內容或權限已變更。你的輸入仍保留在此頁，請先核對；重新讀取會捨棄尚未儲存的修正。</p><button type="button" disabled={busy} onClick={() => void reload()}>捨棄未儲存修正並讀取最新版本</button></div>}
      {settings && <SettingsFields baseline={loaded.baseline} value={settings} disabled={!editable || busy || conflict} onChange={setSettings} />}
      {editable && <AmendmentForm key={formKey} baseline={loaded.baseline} initial={editing === null ? null : changes[editing]}
        disabled={busy || conflict} onDirty={setFormDirty}
        onCancel={resetForm} onAdd={(change) => {
          setChanges((current) => editing === null ? [...current, change] : current.map((item, index) => index === editing ? change : item));
          resetForm();
        }} />}
      <div className={styles.subpanel}><h4>修正清單（{changes.length} 筆）</h4>
        {changes.length === 0 ? <p>尚無修正宣告。</p> : <ol className={styles.amendmentChanges}>{changes.map((change, index) => <li key={index}>
          <strong>{KIND_LABEL[change.kind]}</strong>{" "}{change.kind === "added" || change.kind === "released" ? change.circleName : ""}
          <p>{sourcesOf(change).join("、")}{change.kind === "added" ? change.placements.map((item) => `${item.dayId}:${item.code}`).join("、")
            : change.kind === "moved" ? ` → ${change.moves.map((item) => `${item.to.dayId}:${item.to.code}`).join("、")}` : ""}</p>
          {editable && <div className={styles.row}><button type="button" className={styles.ghost} disabled={busy || conflict || formDirty} onClick={() => { setEditing(index); setFormKey((key) => key + 1); }}>修改此宣告</button>
            <button type="button" className={styles.dangerText} disabled={busy || conflict || formDirty} onClick={() => { setChanges((current) => current.filter((_, at) => at !== index)); resetForm(); }}>取消此修正</button></div>}
        </li>)}</ol>}
        {editable && <button type="button" disabled={busy || conflict || !(changesDirty || settingsDirty) || formDirty} onClick={() => void save()}>{busy ? "儲存中…" : "儲存修正並檢視影響"}</button>}
        {changesDirty && <p className={styles.warning}>清單尚未儲存；下方顯示的影響仍是上次儲存內容。</p>}
        {settingsDirty && <p className={styles.warning}>活動設定尚未儲存；下方顯示的影響仍是上次儲存內容。</p>}
        {formDirty && <p className={styles.warning}>表單尚未加入清單。</p>}
      </div>
      <SettingsImpact impact={loaded.settingsImpact} />
      <AmendmentImpact impact={loaded.impact} />
    </>}
  </section>;
}

function AmendmentForm({ baseline, initial, disabled, onDirty, onAdd, onCancel }: {
  baseline: OrganizerAmendmentDetail["baseline"]; initial: OrganizerAmendmentChange | null;
  disabled: boolean; onDirty: (dirty: boolean) => void; onAdd: (change: OrganizerAmendmentChange) => void; onCancel: () => void;
}) {
  const blank = (): OrganizerAmendmentDestination => ({ dayId: baseline.event.days.length === 1 ? String(baseline.event.days[0].id) : "",
    areaId: baseline.event.areas.length === 1 ? baseline.event.areas[0].id : "", code: "" });
  const [kind, setKind] = useState<OrganizerAmendmentChange["kind"] | "">(initial?.kind ?? "");
  const [sources, setSources] = useState<string[]>(initial ? sourcesOf(initial) : []);
  const [circleName, setCircleName] = useState(initial && "circleName" in initial ? initial.circleName : "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [moves, setMoves] = useState<Record<string, OrganizerAmendmentDestination>>(initial?.kind === "moved" ? Object.fromEntries(initial.moves.map((move) => [move.source, move.to])) : {});
  const [added, setAdded] = useState<OrganizerAmendmentDestination[]>(initial?.kind === "added" ? initial.placements : [blank()]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const choices = useMemo(() => baseline.official.days.flatMap((day) => day.booths.flatMap((booth) => booth.codes.map((code) => ({
    source: `${day.day}:${code}`, code, name: booth.name,
    day: baseline.event.days.find((item) => String(item.id) === String(day.day))?.label ?? String(day.day),
  })))), [baseline]);
  const filtered = choices.filter((item) => `${item.name} ${item.code} ${item.day}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const change = (action: () => void) => { onDirty(true); setError(""); action(); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!kind) { setError("請選擇變動類型。"); return; }
    if (kind !== "added" && sources.length === 0) { setError("請選取已發布的攤位。"); return; }
    const shared = reference.trim() ? { reference: reference.trim() } : {};
    if (reference.trim() && !/^https:\/\//i.test(reference.trim())) { setError("更正依據需使用 HTTPS 網址。"); return; }
    if (kind === "withdrawn") onAdd({ kind, sources, ...shared });
    else if (kind === "released") onAdd({ kind, sources, circleName: circleName.trim(), ...shared });
    else if (kind === "moved") onAdd({ kind, moves: sources.map((source) => ({ source, to: { ...moves[source], code: moves[source].code.trim() } })), ...shared });
    else onAdd({ kind, circleName: circleName.trim(), placements: added.map((item) => ({ ...item, code: item.code.trim() })), ...shared });
  };
  return <form onSubmit={submit} className={styles.subpanel} aria-label="修正宣告表單">
    <h4>{initial ? "修改宣告" : "新增一筆宣告"}</h4>
    <fieldset disabled={disabled} className={styles.amendmentFields}>
      <label>變動類型<select value={kind} required onChange={(event) => change(() => { setKind(event.target.value as typeof kind); setSources([]); setMoves({}); })}>
        <option value="">請選擇</option>{Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {kind === "withdrawn" && <p>社團退出選取的攤位；原社團的收藏與連結會保留退出記錄。</p>}
      {kind === "released" && <p>攤位交給另一個社團。接手者會有自己的連結，原社團的收藏不會改指向接手者。</p>}
      {kind === "moved" && <p>同一社團改用新的攤位位置或代碼，原社團的收藏與連結保持不變。</p>}
      {kind === "added" && <p>新增一個社團及其攤位。請勿用新增來表示既有社團移動。</p>}
      {kind && kind !== "added" && <>
        <label>搜尋已發布攤位<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="社團名稱、攤位或活動日" /></label>
        <p>每筆宣告請選取同一社團的攤位。已選取 {sources.length} 個：{sources.join("、") || "尚未選取"}</p>
        <div className={styles.amendmentSources} role="group" aria-label="已發布攤位">
          {filtered.slice(page * 50, (page + 1) * 50).map((item) => <label key={item.source}><input type="checkbox" checked={sources.includes(item.source)} onChange={(event) => change(() => {
            setSources((current) => event.target.checked ? [...current, item.source] : current.filter((source) => source !== item.source));
            if (event.target.checked) setMoves((current) => ({ ...current, [item.source]: current[item.source] ?? blank() }));
          })} /><span>{item.day}・{item.code}・{item.name}</span></label>)}
          {filtered.length === 0 && <p>沒有符合的攤位。</p>}
        </div>
        {filtered.length > 50 && <div className={styles.row}><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>上一頁</button><span>第 {page + 1}／{Math.ceil(filtered.length / 50)} 頁</span><button type="button" disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(page + 1)}>下一頁</button></div>}
      </>}
      {(kind === "added" || kind === "released") && <label>{kind === "released" ? "接手社團名稱" : "新增社團名稱"}<input value={circleName} maxLength={200} required onChange={(event) => change(() => setCircleName(event.target.value))} /></label>}
      {kind === "moved" && sources.map((source) => <Destination key={source} title={`${source} 的新位置`} baseline={baseline} value={moves[source] ?? blank()}
        onChange={(value) => change(() => setMoves((current) => ({ ...current, [source]: value })))} />)}
      {kind === "added" && <>{added.map((value, index) => <div key={index}><Destination title={`新增攤位 ${index + 1}`} baseline={baseline} value={value}
        onChange={(next) => change(() => setAdded((current) => current.map((item, at) => at === index ? next : item)))} />
        {added.length > 1 && <button type="button" className={styles.ghost} onClick={() => change(() => setAdded((current) => current.filter((_, at) => at !== index)))}>移除此新增攤位</button>}</div>)}
        <button type="button" className={styles.ghost} onClick={() => change(() => setAdded((current) => [...current, blank()]))}>增加一個攤位</button></>}
      {kind && <label>更正依據網址（選填）<input type="url" value={reference} onChange={(event) => change(() => setReference(event.target.value))} placeholder="https://" /></label>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.row}><button type="submit">{initial ? "更新清單中的宣告" : "加入修正清單"}</button><button type="button" className={styles.ghost} onClick={onCancel}>取消此表單</button></div>
    </fieldset>
  </form>;
}

function Destination({ title, baseline, value, onChange }: {
  title: string; baseline: OrganizerAmendmentDetail["baseline"]; value: OrganizerAmendmentDestination; onChange: (value: OrganizerAmendmentDestination) => void;
}) {
  return <fieldset className={styles.amendmentDestination}><legend>{title}</legend>
    <label>活動日<select required value={value.dayId} onChange={(event) => onChange({ ...value, dayId: event.target.value })}><option value="">請選擇活動日</option>{baseline.event.days.map((day) => <option key={day.id} value={day.id}>{day.label}</option>)}</select></label>
    <label>展區<select required value={value.areaId} onChange={(event) => onChange({ ...value, areaId: event.target.value })}><option value="">請選擇展區</option>{baseline.event.areas.map((area) => <option key={area.id} value={area.id}>{area.label ?? area.name ?? area.id}</option>)}</select></label>
    <label>攤位代碼<input required maxLength={80} value={value.code} onChange={(event) => onChange({ ...value, code: event.target.value })} /></label>
  </fieldset>;
}

/** Only the settings ADR-0068 allows a correction to change. Days keep their
 * number and ids; only each day's date can move. */
function SettingsFields({ baseline, value, disabled, onChange }: {
  baseline: OrganizerAmendmentDetail["baseline"]; value: SettingsForm; disabled: boolean; onChange: (value: SettingsForm) => void;
}) {
  const set = (mutate: (next: SettingsForm) => void) => { const next = structuredClone(value); mutate(next); onChange(next); };
  return <fieldset className={`${styles.subpanel} ${styles.amendmentFields}`} disabled={disabled} aria-label="活動設定">
    <h4>活動設定</h4>
    <p>可更正活動名稱、活動別稱與各活動日的日期。</p>
    <label>活動名稱<input value={value.name} onChange={(event) => set((next) => { next.name = event.target.value; })} /></label>
    <div><div className={styles.row}><strong>活動別稱</strong>
      <button type="button" className={styles.ghost} disabled={value.aliases.length >= EVENT_ALIAS_MAX_COUNT}
        onClick={() => set((next) => { next.aliases.push(""); })}>新增別稱</button></div>
      {value.aliases.length === 0 && <p>沒有別稱。</p>}
      {value.aliases.map((alias, index) => <div className={styles.row} key={index}>
        <label>別稱 {index + 1}<input value={alias} onChange={(event) => set((next) => { next.aliases[index] = event.target.value; })} /></label>
        <button type="button" className={styles.dangerText} aria-label={`移除別稱 ${index + 1}`}
          onClick={() => set((next) => { next.aliases.splice(index, 1); })}>移除</button>
      </div>)}
    </div>
    {baseline.event.days.map((day) => <label key={day.id}>{day.label}日期<input type="date" value={value.days[String(day.id)] ?? ""}
      onChange={(event) => set((next) => { next.days[String(day.id)] = event.target.value; })} /></label>)}
  </fieldset>;
}

function SettingsImpact({ impact }: { impact: OrganizerAmendmentSettingsImpact[] }) {
  const label = (item: OrganizerAmendmentSettingsImpact) => item.field === "name" ? "活動名稱" : item.field === "aliases" ? "活動別稱" : `${item.label}日期`;
  const text = (value: string | string[]) => Array.isArray(value) ? value.join("、") || "無" : value;
  return <section className={styles.subpanel} aria-label="已儲存的活動設定更正"><h4>已儲存的活動設定更正</h4>
    {impact.length === 0 ? <p>目前已儲存的內容沒有活動設定變動。</p> : impact.map((item, index) => <div key={index} className={styles.amendmentImpact}>
      <h5>{label(item)}</h5>
      <div><strong>原本</strong><p>{text(item.before)}</p></div>
      <div><strong>修正後</strong><p>{text(item.after)}</p></div>
    </div>)}
  </section>;
}

function AmendmentImpact({ impact }: { impact: OrganizerAmendmentImpact[] }) {
  return <section className={styles.subpanel} aria-label="已儲存修正的影響"><h4>已儲存修正的影響</h4>
    {impact.length === 0 ? <p>目前已儲存的內容沒有名單變動。</p> : impact.map((item, index) => <div key={index} className={styles.amendmentImpact}>
      <h5>{index + 1}. {KIND_LABEL[item.kind]}</h5>
      <div><strong>原本</strong><p>{item.before.map((place) => `${place.name}（${place.dayId}:${place.code}）`).join("、") || "無"}</p></div>
      <div><strong>修正後</strong><p>{item.after.map((place) => `${place.name}（${place.dayId}:${place.code}）`).join("、") || "所選攤位已退出"}</p></div>
      <p>{item.kind === "released" ? "接手社團使用新的連結；原社團的收藏與連結保留。" : item.kind === "moved" ? "社團的收藏與連結保持不變。" : item.kind === "withdrawn" ? "保留原社團的退出記錄。" : "新增社團使用自己的連結。"}</p>
    </div>)}
  </section>;
}
