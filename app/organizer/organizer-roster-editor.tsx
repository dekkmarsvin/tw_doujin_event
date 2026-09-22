import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PortalError } from "../circle-editor-client";
import { putOrganizerImport, saveOrganizerEvent, type OrganizerEventDetail } from "../organizer-client";
import { withOrganizerImportedAreaIds } from "../organizer-event";
import type { OrganizerNormalizedImportRow } from "../organizer-import";
import { mergeRosterRows, normalizeRosterRow, rosterIssues, rosterMergeError, splitRosterRow, suspiciousRosterCodes } from "../organizer-roster";
import { message, organizerDayLabel, organizerVenueSpaceLabel } from "./organizer-shared";
import styles from "./organizer.module.css";

type Entry = { key: number; row: OrganizerNormalizedImportRow };
const entriesOf = (rows: readonly OrganizerNormalizedImportRow[]) => rows.map((row, key) => ({ key, row }));

export function SavedImportList({ detail, onChanged, onDirtyChange, onSaveReady }: {
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onSaveReady: (save: (() => Promise<boolean>) | null) => void;
}) {
  const [entries, setEntries] = useState(() => entriesOf(detail.import?.rows ?? []));
  const [nextKey, setNextKey] = useState(entries.length);
  const [expectedVersion, setExpectedVersion] = useState(detail.event.version);
  const [loadedVersion, setLoadedVersion] = useState(detail.event.version);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const editFormRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [splitCodes, setSplitCodes] = useState<string[] | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeName, setMergeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [day, setDay] = useState("");
  const [space, setSpace] = useState("");
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(0);
  const editable = detail.event.operation !== "AMEND" && ["draft", "changes_requested"].includes(detail.event.status);
  // A refreshed version may update a clean view, never lend its newer version
  // to older unsaved rows. A stale draft must still receive the API's 409.
  if (!dirty && loadedVersion !== detail.event.version && detail.event.version >= expectedVersion) {
    setEntries(entriesOf(detail.import?.rows ?? []));
    setNextKey(detail.import?.rows.length ?? 0);
    setExpectedVersion(detail.event.version);
    setLoadedVersion(detail.event.version);
    setSelected([]); setActiveKey(null); setSplitCodes(null); setMerging(false);
  }
  useEffect(() => {
    onDirtyChange(dirty);
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { onDirtyChange(false); window.removeEventListener("beforeunload", warn); };
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (activeKey === null) return;
    editFormRef.current?.scrollIntoView({ block: "nearest" });
    editFormRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>("input,select")?.focus({ preventScroll: true });
  }, [activeKey]);
  const normalized = useMemo(() => entries.map(entry => normalizeRosterRow(entry.row, detail.draft)), [entries, detail.draft]);
  const needsAreaUpdate = normalized.some((row, index) => row.areaId !== entries[index].row.areaId);
  const errors = useMemo(() => rosterIssues(normalized, detail.draft), [normalized, detail.draft]);
  const limitError = useMemo(() => normalized.length > 20_000 ? "清單最多 20,000 列。"
    : new TextEncoder().encode(JSON.stringify(normalized)).byteLength > 8 * 1024 * 1024 ? "清單超過 8 MB，請縮短欄位內容或核對活動範圍。" : null, [normalized]);
  const save = useCallback(async () => {
    if (!detail.import || !editable || busy || conflict) return false;
    if (errors.size || limitError) { setNotice("請先修正清單中的問題，再儲存。"); return false; }
    if (!dirty && !needsAreaUpdate) return true;
    setBusy(true); setNotice("");
    try {
      const withAreas = withOrganizerImportedAreaIds(detail.draft, normalized);
      let version = expectedVersion;
      if (JSON.stringify(withAreas) !== JSON.stringify(detail.draft)) {
        version = (await saveOrganizerEvent(detail.event.id, version, withAreas)).version;
        setExpectedVersion(version);
      }
      const saved = await putOrganizerImport(detail.event.id, { expectedVersion: version, source: detail.import.source, rows: normalized });
      setExpectedVersion(saved.version);
      setDirty(false); onDirtyChange(false);
      setEntries(current => current.map((entry, index) => ({ ...entry, row: normalized[index] })));
      setNotice("清單已儲存；公開活動尚未改變。");
      try { await onChanged(); }
      catch (error) { setNotice(`清單已儲存，但重新讀取失敗：${message(error)}`); }
      return true;
    } catch (error) {
      setNotice(message(error));
      if (error instanceof PortalError && error.status === 409) setConflict(true);
      return false;
    } finally { setBusy(false); }
  }, [detail, editable, busy, conflict, errors.size, limitError, dirty, needsAreaUpdate, normalized, expectedVersion, onDirtyChange, onChanged]);
  useEffect(() => { onSaveReady(save); return () => onSaveReady(null); }, [save, onSaveReady]);
  const change = (next: Entry[]) => { setEntries(next); setDirty(true); setNotice(""); };
  const update = (key: number, patch: Partial<OrganizerNormalizedImportRow>) => {
    change(entries.map(entry => entry.key === key ? { ...entry, row: { ...entry.row, ...patch } } : entry));
    setSplitCodes(null);
  };
  const discard = async () => {
    setBusy(true);
    try {
      await onChanged();
      setDirty(false); setConflict(false); setExpectedVersion(0); setLoadedVersion(-1);
      setEditing(false); setNotice("");
    } catch (error) { setNotice(message(error)); }
    finally { setBusy(false); }
  };
  const filtered = useMemo(() => {
    const needle = query.normalize("NFKC").toLocaleLowerCase("zh-Hant");
    return entries.filter(({ row }) => (!day || row.dayId === day) && (!space || row.venueSpaceId === space)
      && [row.circleName, row.stableKey ?? "", ...row.codes].some(value => value.toLocaleLowerCase("zh-Hant").includes(needle)))
      .toSorted((a, b) => (descending ? -1 : 1) * (a.row.codes[0] ?? "").localeCompare(b.row.codes[0] ?? "", "zh-Hant", { numeric: true }));
  }, [entries, query, day, space, descending]);
  const pages = Math.max(1, Math.ceil(filtered.length / 100)), shownPage = Math.min(page, pages - 1);
  const active = entries.find(entry => entry.key === activeKey);
  const activeIndex = entries.findIndex(entry => entry.key === activeKey);
  const chosen = entries.filter(entry => selected.includes(entry.key));
  const chosenRows = chosen.map(entry => normalizeRosterRow(entry.row, detail.draft));
  const mergeError = rosterMergeError(chosenRows);
  const names = [...new Set(chosenRows.map(row => row.circleName))];
  const suggestedWidth = active ? suspiciousRosterCodes(active.row) : null;
  const savedDays = [...new Set(entries.map(({ row }) => row.dayId))];
  const savedSpaces = [...new Set(entries.map(({ row }) => row.venueSpaceId))];
  const source = detail.import?.source;
  return <section aria-label="已儲存的攤位清單" className={styles.importPreview}>
    <h4>已儲存的攤位清單</h4>
    <p>{entries.length} 列・{entries.reduce((total, entry) => total + entry.row.codes.length, 0)} 個攤位代碼。{dirty ? "尚有未儲存變更。" : "可搜尋與核對已匯入的群組。"}</p>
    {source && <details><summary>匯入出處</summary><p>{source.fileName}{source.worksheet ? `・${source.worksheet}` : ""}・{source.sourceDescription}</p>
      <p style={{ overflowWrap: "anywhere" }}>原檔 SHA-256：{source.sha256}</p><p>此雜湊只識別原始檔，編輯後清單以儲存版本與送審快照為準。來源列只供回查原檔。</p></details>}
    {editable && !editing && <button type="button" onClick={() => setEditing(true)}>編輯清單</button>}
    {editable && needsAreaUpdate && <p role="status">使用空間已改為無分區，儲存清單即可套用。</p>}
    {editing && <fieldset className={styles.formFields} disabled={!editable || busy} aria-label="清單編輯">
      <div className={styles.row}>
        <button type="button" disabled={entries.length >= 20_000} onClick={() => {
          const assignment = detail.draft.venue.assignments[0];
          const row = { sourceRow: 0, dayId: detail.draft.event.days[0]?.id ?? "", venueSpaceId: assignment?.venueSpaceId ?? "", areaId: assignment?.areaMode === "none" ? "ALL" : assignment?.areaIds[0] ?? "", codes: [], circleName: "", stableKey: null, identityGroup: null };
          change([...entries, { key: nextKey, row }]); setActiveKey(nextKey); setNextKey(nextKey + 1); setSplitCodes(null);
        }}>新增群組</button>
        <button type="button" disabled={!!mergeError} onClick={() => { setMerging(true); setMergeName(names.length === 1 ? names[0] : ""); }}>合併選取的 {chosen.length} 組</button>
        <button type="button" disabled={(!dirty && !needsAreaUpdate) || conflict || errors.size > 0 || !!limitError} onClick={() => { void save(); }}>{busy ? "儲存中…" : "儲存清單變更"}</button>
        <button type="button" className={styles.ghost} onClick={() => { void discard(); }}>{dirty || conflict ? "放棄變更並重新載入" : "結束編輯"}</button>
      </div>
      {chosen.length > 1 && mergeError && <p role="alert">{mergeError}</p>}
      {merging && <div className={styles.rosterForm}>
        <label>合併後保留的社團名稱<select value={mergeName} onChange={event => setMergeName(event.target.value)}><option value="">請選擇保留名稱</option>{names.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        <p>合併 {chosen.length} 組，保留全部攤位代碼；不同主辦內部編號不能直接合併。</p>
        <div className={styles.row}><button type="button" disabled={!!mergeError || !mergeName} onClick={() => {
          const merged = mergeRosterRows(chosenRows, mergeName);
          if (!merged) return;
          change(entries.flatMap(entry => entry.key === chosen[0].key ? [{ ...entry, row: merged }] : selected.includes(entry.key) ? [] : [entry]));
          setActiveKey(chosen[0].key); setSelected([]); setMerging(false); setSplitCodes(null);
        }}>確認合併</button><button type="button" className={styles.ghost} onClick={() => setMerging(false)}>取消合併</button></div>
      </div>}
      {active && <div ref={editFormRef} className={styles.rosterForm} role="group" aria-label="編輯攤位群組">
        <h5>{active.row.sourceRow === 0 ? "手動群組" : `來源列 ${active.row.sourceRow} 的群組`}</h5>
        <div className={styles.importGrid}>
          <label>群組活動日<select value={active.row.dayId} onChange={event => update(active.key, { dayId: event.target.value })}><option value="">請選擇</option>{detail.draft.event.days.map(day => <option key={day.id} value={day.id}>{day.label}</option>)}</select></label>
          <label>群組使用空間<select value={active.row.venueSpaceId} onChange={event => {
            const assignment = detail.draft.venue.assignments.find(space => space.venueSpaceId === event.target.value);
            update(active.key, { venueSpaceId: event.target.value, areaId: assignment?.areaMode === "none" ? "ALL" : assignment?.areaIds[0] ?? "" });
          }}><option value="">請選擇</option>{detail.draft.venue.assignments.map(space => <option key={space.venueSpaceId} value={space.venueSpaceId}>{organizerVenueSpaceLabel(detail.venueCatalog, space.venueSpaceId)}</option>)}</select></label>
          {detail.draft.venue.assignments.some(space => space.venueSpaceId === active.row.venueSpaceId && space.areaMode === "none") ? <p>展區：無分區</p>
            : <label>群組展區<input value={active.row.areaId} onChange={event => update(active.key, { areaId: event.target.value })} /><small>儲存時依清單更新已宣告展區。</small></label>}
          <label>群組攤位代碼<input value={active.row.codes.join("、")} onChange={event => update(active.key, { codes: event.target.value.split(/[、,，;；/\s]+/u) })} /><small>以頓號、逗號或空白分隔；不會猜拆連寫代碼。</small></label>
          <label>群組社團名稱<input maxLength={200} value={active.row.circleName} onChange={event => update(active.key, { circleName: event.target.value })} /></label>
          <label>群組主辦內部編號<input value={active.row.stableKey ?? ""} onChange={event => update(active.key, { stableKey: event.target.value || null, identityGroup: event.target.value ? `stable:${event.target.value}` : null })} /><small>相同編號表示同一社團；相同名稱不會自動合併。</small></label>
        </div>
        {suggestedWidth && <p role="status">代碼可能連寫。<button type="button" className={styles.ghost} onClick={() => update(active.key, { codes: active.row.codes.flatMap(code => [...code].length % suggestedWidth === 0 ? Array.from({ length: [...code].length / suggestedWidth }, (_, i) => [...code].slice(i * suggestedWidth, (i + 1) * suggestedWidth).join("")) : [code]) })}>確認每 {suggestedWidth} 字拆成一碼</button></p>}
        {errors.get(activeIndex)?.map((error, index) => <p key={index} className={styles.issueError} role="alert">{error}</p>)}
        <div className={styles.row}>
          <button type="button" className={styles.ghost} disabled={active.row.codes.length < 2 || entries.length >= 20_000 || errors.has(activeIndex)} onClick={() => setSplitCodes([])}>拆分群組</button>
          <button type="button" className={styles.ghost} onClick={() => { change(entries.filter(entry => entry.key !== active.key)); setSelected(selected.filter(key => key !== active.key)); setActiveKey(null); setSplitCodes(null); }}>刪除此群組</button>
          <button type="button" className={styles.ghost} onClick={() => { setActiveKey(null); setSplitCodes(null); }}>關閉群組編輯</button>
        </div>
        {splitCodes && <div><p>勾選要移到另一組的代碼；兩組先保留原社團名稱與主辦內部編號。</p>
          <div className={styles.row}>{active.row.codes.map(code => <label key={code} className={styles.rosterChoice}><input type="checkbox" checked={splitCodes.includes(code)} onChange={event => setSplitCodes(event.target.checked ? [...splitCodes, code] : splitCodes.filter(item => item !== code))} />{code}</label>)}</div>
          <button type="button" disabled={!splitCodes.length || splitCodes.length >= active.row.codes.length || entries.length >= 20_000} onClick={() => {
            const split = splitRosterRow(active.row, splitCodes);
            if (split.length !== 2) return;
            change(entries.flatMap(entry => entry.key === active.key ? [{ key: entry.key, row: split[0] }, { key: nextKey, row: split[1] }] : [entry]));
            setNextKey(nextKey + 1); setSplitCodes(null);
          }}>確認拆分</button><button type="button" className={styles.ghost} onClick={() => setSplitCodes(null)}>取消拆分</button>
        </div>}
      </div>}
      {limitError && <p role="alert">{limitError}</p>}
      {errors.size > 0 && <div role="alert"><p>{errors.size} 組有待修正項目。</p>{[...errors].slice(0, 5).map(([index, reasons]) => <p key={entries[index].key}>
        <button type="button" className={styles.ghost} onClick={() => { setActiveKey(entries[index].key); setSplitCodes(null); }}>{normalized[index].codes.join("、") || "未填代碼"}：前往修正</button> {reasons[0]}
      </p>)}</div>}
    </fieldset>}
    {notice && <p role="status">{notice}</p>}
    {conflict && <p role="alert">清單已被更新，本次草稿仍保留。請先複製需要保留的內容，再放棄變更並重新載入；不會覆寫新版本。</p>}
    <div className={styles.importGrid}>
      <label>搜尋清單<input type="search" value={query} placeholder="社團、攤位或主辦內部編號" onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>清單活動日<select value={day} onChange={event => { setDay(event.target.value); setPage(0); }}><option value="">全部活動日</option>{savedDays.map(id => <option key={id} value={id}>{organizerDayLabel(detail.draft.event.days, id)}</option>)}</select></label>
      <label>清單使用空間<select value={space} onChange={event => { setSpace(event.target.value); setPage(0); }}><option value="">全部使用空間</option>{savedSpaces.map(id => <option key={id} value={id}>{organizerVenueSpaceLabel(detail.venueCatalog, id)}</option>)}</select></label>
      <label>攤位排序<select value={descending ? "desc" : "asc"} onChange={event => { setDescending(event.target.value === "desc"); setPage(0); }}><option value="asc">代碼由小到大</option><option value="desc">代碼由大到小</option></select></label>
    </div>
    <p role="status">符合 {filtered.length} 列・第 {shownPage + 1} / {pages} 頁</p>
    <div className={`${styles.sampleTable} ${styles.savedImportTable}`}><table><thead><tr><th>來源列</th><th>活動日</th><th>使用空間</th><th>展區</th><th>攤位代碼</th><th>社團名稱</th><th>主辦內部編號</th>{editing && <th>編輯</th>}</tr></thead>
      <tbody>{filtered.slice(shownPage * 100, (shownPage + 1) * 100).map(({ key, row }) => <tr key={key}>
        <td>{row.sourceRow === 0 ? "手動新增／合併" : row.sourceRow}</td><td>{organizerDayLabel(detail.draft.event.days, row.dayId)}</td><td>{organizerVenueSpaceLabel(detail.venueCatalog, row.venueSpaceId)}</td><td>{detail.draft.venue.assignments.some(assignment => assignment.venueSpaceId === row.venueSpaceId && assignment.areaMode === "none") ? "無分區" : row.areaId}</td><td>{row.codes.join("、")}{suspiciousRosterCodes(row) && <small>・請核對連寫代碼</small>}</td><td>{row.circleName}</td><td>{row.stableKey ?? "—"}</td>
        {editing && <td><label className={styles.rosterChoice}><input type="checkbox" aria-label={`選取群組 ${row.codes.join("、") || "未填代碼"}`} disabled={busy || !editable} checked={selected.includes(key)} onChange={event => { setSelected(event.target.checked ? [...selected, key] : selected.filter(item => item !== key)); setMerging(false); }} />合併</label>
          <button type="button" className={styles.ghost} disabled={busy || !editable} onClick={() => { setActiveKey(key); setSplitCodes(null); }}>編輯</button></td>}
      </tr>)}</tbody></table></div>
    {filtered.length === 0 && <p>沒有符合條件的攤位。</p>}
    <div className={styles.row}><button type="button" className={styles.ghost} disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>上一頁</button><button type="button" className={styles.ghost} disabled={shownPage + 1 >= pages} onClick={() => setPage(shownPage + 1)}>下一頁</button></div>
  </section>;
}
