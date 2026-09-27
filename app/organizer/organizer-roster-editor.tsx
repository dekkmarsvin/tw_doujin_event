import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PortalError } from "../circle-editor-client";
import { listOrganizerMaps, putOrganizerImport, saveOrganizerEvent, type OrganizerEventDetail, type OrganizerMapLocation, type OrganizerMapSummary } from "../organizer-client";
import { boothGroupCoverage } from "../map-booth-coverage";
import { withOrganizerImportedAreaIds } from "../organizer-event";
import type { OrganizerNormalizedImportRow } from "../organizer-import";
import { mergeRosterRows, normalizeRosterRow, rosterFieldIssues, rosterMergeError, splitRosterRow, suspiciousRosterCodes, type RosterField } from "../organizer-roster";
import { message, organizerDayLabel, organizerVenueSpaceLabel } from "./organizer-shared";
import { AreaNameFields, type AreaNames } from "./organizer-area-names";
import { RosterCell } from "./organizer-roster-cell";
import { RosterDialog } from "./organizer-roster-dialog";
import { CrossDayCircles } from "./organizer-cross-day-circles";
import styles from "./organizer.module.css";

type Entry = { key: number; row: OrganizerNormalizedImportRow };
const entriesOf = (rows: readonly OrganizerNormalizedImportRow[]) => rows.map((row, key) => ({ key, row }));
const scopeKey = (day: string, space: string) => JSON.stringify([day, space]);
const areaKey = (space: string, area: string) => JSON.stringify([space, area]);
type PageSize = 25 | 50 | 100 | "all";
// Every row re-renders on each keystroke, so showing everything stays fast only for a short list.
const ALL_ROWS_LIMIT = 500;
const PAGE_SIZE_KEY = "organizer-roster-page-size";
const readPageSize = (): PageSize => {
  try { const saved = localStorage.getItem(PAGE_SIZE_KEY); return saved === "all" ? "all" : saved === "25" ? 25 : saved === "50" ? 50 : 100; } catch { return 100; }
};

export function SavedImportList({ detail, onChanged, onDirtyChange, onSaveReady, onLocate, onImport }: {
  detail: OrganizerEventDetail; onChanged: () => Promise<void>; onDirtyChange: (dirty: boolean) => void;
  onSaveReady: (save: (() => Promise<boolean>) | null) => void;
  onLocate: (location: OrganizerMapLocation) => void; onImport: () => void;
}) {
  const [entries, setEntries] = useState(() => entriesOf(detail.import?.rows ?? []));
  // A view snapshot keeps an edited row under the cursor until an explicit filter/sort or save.
  const [viewEntries, setViewEntries] = useState(entries);
  const [baseline, setBaseline] = useState(() => new Map(entries.map(entry => [entry.key, entry.row])));
  const [nextKey, setNextKey] = useState(entries.length);
  const [expectedVersion, setExpectedVersion] = useState(detail.event.version);
  const [loadedVersion, setLoadedVersion] = useState(detail.event.version);
  const [writeDraft, setWriteDraft] = useState(detail.draft);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState<"save" | "reload" | "aliases" | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [day, setDay] = useState("");
  const [space, setSpace] = useState("");
  const [area, setArea] = useState("");
  const [mapState, setMapState] = useState("");
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(readPageSize);
  const [showInternal, setShowInternal] = useState(false);
  const [maps, setMaps] = useState<OrganizerMapSummary[] | null>(null);
  const [coverageError, setCoverageError] = useState("");
  const [action, setAction] = useState<{ kind: "details" | "split" | "delete"; key: number } | { kind: "merge" } | null>(null);
  const [splitCodes, setSplitCodes] = useState<string[]>([]);
  const [mergeName, setMergeName] = useState("");
  const [aliasesOpen, setAliasesOpen] = useState(false);
  const [aliasCloseRequested, setAliasCloseRequested] = useState(false);
  const [labels, setLabels] = useState<AreaNames>({});
  const [pending, setPending] = useState<"import" | "aliases" | "discard" | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editable = detail.event.operation !== "AMEND" && ["draft", "changes_requested"].includes(detail.event.status);
  const aliasesDirty = Object.keys(labels).length > 0;
  const circleRows = useMemo(() => entries.map(entry => entry.row), [entries]);
  const anyDirty = dirty || aliasesDirty;
  if (!anyDirty && loadedVersion !== detail.event.version && detail.event.version >= expectedVersion) {
    const next = entriesOf(detail.import?.rows ?? []);
    setBaseline(new Map(next.map(entry => [entry.key, entry.row])));
    setEntries(next); setViewEntries(next); setNextKey(next.length);
    setExpectedVersion(detail.event.version); setLoadedVersion(detail.event.version);
    setWriteDraft(detail.draft);
    setSelected([]); setAction(null);
  }
  useEffect(() => {
    let ignore = false;
    void listOrganizerMaps(detail.event.id, true).then(result => {
      if (!ignore) { setMaps(result.maps); setCoverageError(""); }
    }).catch(error => { if (!ignore) { setMaps(null); setCoverageError(message(error)); } });
    return () => { ignore = true; };
  }, [detail.event.id, detail.event.version]);
  const coverageByScope = useMemo(() => new Map((maps ?? []).map(map => [scopeKey(map.periodKey, map.venueSpaceId), {
    map, drawn: map.boothCodes ? new Set(map.boothCodes) : null,
  }])), [maps]);
  const coverageOf = useCallback((row: OrganizerNormalizedImportRow) => {
    const saved = coverageByScope.get(scopeKey(row.dayId, row.venueSpaceId));
    return maps === null || (saved && !saved.drawn) ? null : boothGroupCoverage(row.codes, saved?.drawn ?? new Set<string>());
  }, [maps, coverageByScope]);
  useEffect(() => {
    onDirtyChange(anyDirty);
    const warn = (event: BeforeUnloadEvent) => { if (anyDirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { onDirtyChange(false); window.removeEventListener("beforeunload", warn); };
  }, [anyDirty, onDirtyChange]);
  useLayoutEffect(() => {
    const size = () => { if (tableRef.current) tableRef.current.style.height = `${Math.max(280, window.innerHeight - tableRef.current.getBoundingClientRect().top - 76)}px`; };
    size();
    const observer = new ResizeObserver(size);
    if (toolbarRef.current) observer.observe(toolbarRef.current);
    window.addEventListener("resize", size);
    return () => { observer.disconnect(); window.removeEventListener("resize", size); };
  }, [notice, dirty, selected.length, coverageError]);
  const normalized = useMemo(() => entries.map(entry => normalizeRosterRow(entry.row, detail.draft)), [entries, detail.draft]);
  const errors = useMemo(() => rosterFieldIssues(normalized, detail.draft), [normalized, detail.draft]);
  const needsAreaUpdate = normalized.some((row, index) => row.areaId !== entries[index].row.areaId);
  // Only the saved list counts as finished; pending edits and issues already say so beside their own controls.
  const done = !anyDirty && !needsAreaUpdate && !conflict && !refreshRequired && errors.size === 0
    && detail.workspace.readiness.sections.some(item => item.id === "import" && item.state === "complete");
  const limitError = useMemo(() => normalized.length > 20_000 ? "名單最多 20,000 筆。"
    : new TextEncoder().encode(JSON.stringify(normalized)).byteLength > 8 * 1024 * 1024 ? "名單超過 8 MB，請縮短欄位內容。" : null, [normalized]);
  const save = useCallback(async () => {
    if (!detail.import || !editable || busy || conflict || aliasesOpen || refreshRequired) return false;
    if (errors.size || limitError) { setNotice("請先修正標記的欄位。"); return false; }
    if (!dirty && !needsAreaUpdate) return true;
    setBusy("save"); setNotice("");
    try {
      const withAreas = withOrganizerImportedAreaIds(writeDraft, normalized);
      let version = expectedVersion;
      if (JSON.stringify(withAreas) !== JSON.stringify(writeDraft)) {
        version = (await saveOrganizerEvent(detail.event.id, version, withAreas)).version;
        setExpectedVersion(version);
        setWriteDraft(withAreas);
      }
      const saved = await putOrganizerImport(detail.event.id, { expectedVersion: version, source: detail.import.source, rows: normalized });
      setExpectedVersion(saved.version);
      const next = entries.map((entry, index) => ({ ...entry, row: normalized[index] }));
      setBaseline(new Map(next.map(entry => [entry.key, entry.row])));
      setEntries(next); setViewEntries(next); setDirty(false); onDirtyChange(false); setNotice("名單已儲存。");
      try { await onChanged(); } catch (error) { setPending(null); setRefreshRequired(true); setNotice(`名單已儲存，但重新讀取失敗：${message(error)}`); return false; }
      return true;
    } catch (error) {
      setNotice(message(error)); if (error instanceof PortalError && error.status === 409) setConflict(true); return false;
    } finally { setBusy(null); }
  }, [detail, editable, busy, conflict, aliasesOpen, refreshRequired, writeDraft, errors.size, limitError, dirty, needsAreaUpdate, normalized, entries, expectedVersion, onDirtyChange, onChanged]);
  useEffect(() => { onSaveReady(save); return () => onSaveReady(null); }, [save, onSaveReady]);
  const change = (next: Entry[]) => {
    const restored = next.map(entry => {
      const original = baseline.get(entry.key);
      return original && entry.row !== original && JSON.stringify(entry.row) === JSON.stringify(original) ? { ...entry, row: original } : entry;
    });
    setEntries(restored); setDirty(restored.length !== baseline.size || restored.some(entry => entry.row !== baseline.get(entry.key))); setNotice("");
  };
  const update = (key: number, patch: Partial<OrganizerNormalizedImportRow>) => change(entries.map(entry => entry.key === key ? { ...entry, row: { ...entry.row, ...patch } } : entry));
  const discard = async () => {
    setBusy("reload");
    try { await onChanged(); setDirty(false); setConflict(false); setLabels({}); setExpectedVersion(0); setLoadedVersion(-1); setNotice(""); return true; }
    catch (error) { setNotice(message(error)); return false; } finally { setBusy(null); }
  };
  const perform = (target: "import" | "aliases" | "discard") => {
    setPending(null); if (target === "import") onImport(); if (target === "aliases") { setLabels({}); setNotice(""); setAliasesOpen(true); }
  };
  const request = (target: "import" | "aliases") => { if (dirty || conflict) setPending(target); else perform(target); };
  const rescope = () => { setViewEntries(entries); setPage(0); };
  const clearFilters = () => { setQuery(""); setDay(""); setSpace(""); setArea(""); setMapState(""); rescope(); };
  const filtered = useMemo(() => {
    const needle = query.normalize("NFKC").toLocaleLowerCase("zh-Hant");
    return viewEntries.filter(({ row }) => (!day || row.dayId === day) && (!space || row.venueSpaceId === space)
      && (!area || areaKey(row.venueSpaceId, row.areaId) === area) && (!mapState || (coverageOf(row)?.label ?? "尚未取得") === mapState)
      && [row.circleName, row.stableKey ?? "", ...row.codes].some(value => value.normalize("NFKC").toLocaleLowerCase("zh-Hant").includes(needle)))
      .toSorted((a, b) => (descending ? -1 : 1) * (a.row.codes[0] ?? "").localeCompare(b.row.codes[0] ?? "", "zh-Hant", { numeric: true }));
  }, [viewEntries, query, day, space, area, mapState, descending, coverageOf]);
  const byKey = useMemo(() => new Map(entries.map((entry, index) => [entry.key, { ...entry, index }])), [entries]);
  const visible = filtered.filter(entry => byKey.has(entry.key));
  const sizeFor = (count: number) => pageSize !== "all" ? pageSize : count <= ALL_ROWS_LIMIT ? Math.max(1, count) : 100;
  const size = sizeFor(visible.length);
  const pages = Math.max(1, Math.ceil(visible.length / size)), shownPage = Math.min(page, pages - 1);
  const chosen = entries.filter(entry => selected.includes(entry.key));
  const chosenRows = chosen.map(entry => normalizeRosterRow(entry.row, detail.draft));
  const mergeError = rosterMergeError(chosenRows);
  const names = [...new Set(chosenRows.map(row => row.circleName))];
  const active = action && "key" in action ? byKey.get(action.key) : undefined;
  const days = detail.draft.event.days, assignments = detail.draft.venue.assignments;
  const hasAreas = assignments.some(item => item.areaMode !== "none" && item.areaIds.length);
  const showDay = days.length !== 1 || entries.some(entry => entry.row.dayId !== days[0]?.id);
  const showSpace = assignments.length !== 1 || entries.some(entry => entry.row.venueSpaceId !== assignments[0]?.venueSpaceId);
  const areaLabel = (spaceId: string, id: string) => {
    const assignment = assignments.find(item => item.venueSpaceId === spaceId);
    return assignment?.areaMode === "none" ? "無分區" : assignment?.areaLabels?.[id] ? `${assignment.areaLabels[id]}（${id}）` : id;
  };
  const focusError = (index: number) => {
    const entry = entries[index]; clearFilters();
    const sorted = [...entries].sort((a, b) => (descending ? -1 : 1) * (a.row.codes[0] ?? "").localeCompare(b.row.codes[0] ?? "", "zh-Hant", { numeric: true }));
    setPage(Math.floor(sorted.findIndex(item => item.key === entry.key) / sizeFor(entries.length)));
    const field = Object.keys(errors.get(index) ?? {})[0];
    requestAnimationFrame(() => tableRef.current?.querySelector<HTMLButtonElement>(`[data-roster-cell="${entry.key}-${field}"]`)?.click());
  };
  return <section aria-label="攤位名單" className={styles.rosterWorkspace}>
    <div ref={toolbarRef}>
      <div className={styles.panelHead}><div><h3>攤位名單</h3><span>{entries.length.toLocaleString()} 筆</span>{done && <span className={styles.rosterDone}> · 已完成</span>}</div><div className={styles.row}>
        <button type="button" className={styles.secondary} disabled={!editable || !!busy || refreshRequired} onClick={() => request("import")}>匯入檔案</button>
        <button type="button" className={styles.secondary} disabled={!editable || !!busy || entries.length >= 20_000 || conflict || refreshRequired} onClick={() => {
          const assignment = assignments.length === 1 ? assignments[0] : assignments.find(item => item.venueSpaceId === space);
          const row = { sourceRow: 0, dayId: day || (days.length === 1 ? days[0].id : ""), venueSpaceId: assignment?.venueSpaceId ?? "", areaId: assignment?.areaMode === "none" ? "ALL" : assignment?.areaIds.length === 1 ? assignment.areaIds[0] : "", codes: [], circleName: "", stableKey: null, identityGroup: null };
          const next = [...entries, { key: nextKey, row }]; clearFilters(); setDescending(false); change(next); setViewEntries(next); setNextKey(nextKey + 1);
          requestAnimationFrame(() => tableRef.current?.querySelector<HTMLButtonElement>(`[data-roster-cell="${nextKey}-codes"]`)?.click());
        }}>新增攤位</button>
        <button type="button" className={styles.secondary} disabled={!editable || !!busy || !hasAreas || refreshRequired} onClick={() => request("aliases")}>展區名稱</button>
      </div></div>
      <CrossDayCircles rows={circleRows} detail={detail} />
      {(!showDay || !showSpace) && <p className={styles.rosterContext}>{!showDay && days[0]?.label}{!showDay && !showSpace && " · "}{!showSpace && organizerVenueSpaceLabel(detail.venueCatalog, assignments[0].venueSpaceId)}</p>}
      <div className={styles.rosterFilters}>
        <label className={styles.rosterSearch}>搜尋<input type="search" value={query} placeholder="社團、攤位或主辦內部編號" onChange={event => { setQuery(event.target.value); rescope(); }} /></label>
        {showDay && <label>活動日<select aria-label="活動日" value={day} onChange={event => { setDay(event.target.value); rescope(); }}><option value="">全部活動日</option>{days.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
        {showSpace && <label>場地<select aria-label="場地" value={space} onChange={event => { setSpace(event.target.value); setArea(""); rescope(); }}><option value="">全部場地</option>{assignments.map(item => <option key={item.venueSpaceId} value={item.venueSpaceId}>{organizerVenueSpaceLabel(detail.venueCatalog, item.venueSpaceId)}</option>)}</select></label>}
        <label>展區<select aria-label="展區" value={area} onChange={event => { setArea(event.target.value); rescope(); }}><option value="">全部展區</option>{assignments.filter(item => !space || item.venueSpaceId === space).map(item => <optgroup key={item.venueSpaceId} label={organizerVenueSpaceLabel(detail.venueCatalog, item.venueSpaceId)}>{item.areaIds.map(id => <option key={id} value={areaKey(item.venueSpaceId, id)}>{areaLabel(item.venueSpaceId, id)}</option>)}</optgroup>)}</select></label>
        <label>地圖狀態<select aria-label="地圖狀態" value={mapState} onChange={event => { setMapState(event.target.value); rescope(); }}><option value="">全部狀態</option>{["待畫", "部分已畫", "已畫", "尚未取得"].map(state => <option key={state}>{state}</option>)}</select></label>
        <label>攤位排序<select aria-label="攤位排序" value={descending ? "desc" : "asc"} onChange={event => { setDescending(event.target.value === "desc"); rescope(); }}><option value="asc">代碼由小到大</option><option value="desc">代碼由大到小</option></select></label>
      </div>
      <div className={styles.rosterTools}><span role="status">符合 {visible.length.toLocaleString()} 筆</span>
        {(query || day || space || area || mapState) && <button type="button" className={styles.textButton} onClick={clearFilters}>清除篩選</button>}
        <label className={styles.rosterChoice}><input type="checkbox" checked={showInternal} onChange={event => setShowInternal(event.target.checked)} />顯示主辦內部編號</label>
        {selected.length > 0 && <><span>已選取 {selected.length} 筆</span><button type="button" className={styles.secondary} disabled={!!mergeError || !!busy || conflict || refreshRequired} onClick={() => { setAction({ kind: "merge" }); setMergeName(names.length === 1 ? names[0] : ""); }}>合併選取</button><button type="button" className={styles.textButton} onClick={() => setSelected([])}>清除選取</button></>}
      </div>
      {chosen.length > 1 && mergeError && <p role="status">{mergeError}</p>}
      {notice && <p role="status">{notice}</p>}
      {refreshRequired && <button type="button" disabled={!!busy} onClick={() => {
        setBusy("reload");
        void onChanged().then(() => { setRefreshRequired(false); setNotice(""); setPending(null); }).catch(error => setNotice(`重新讀取失敗：${message(error)}`)).finally(() => setBusy(null));
      }}>{busy === "reload" ? "重新讀取中…" : "重新讀取名單"}</button>}
      {coverageError && <p role="status">無法讀取地圖狀態：{coverageError}</p>}
      {limitError && <p role="alert">{limitError}</p>}
      {errors.size > 0 && <div className={styles.rosterErrors} role="alert"><strong>{errors.size} 筆待修正</strong>{[...errors].slice(0, 5).map(([index]) => <button type="button" className={styles.textButton} key={entries[index].key} onClick={() => focusError(index)}>{entries[index].row.codes.join("、") || "未填代碼"}：前往修正</button>)}</div>}
      {conflict && <p role="alert">名單已被更新，本次修改仍保留。請先複製需要保留的內容，再放棄變更並重新載入。</p>}
    </div>
    <div ref={tableRef} className={styles.rosterTable}><table><thead><tr>{editable && <th aria-label="選取" />}<th>攤位代碼</th><th className={styles.circleColumn}>社團名稱</th>{showDay && <th>活動日</th>}{showSpace && <th>場地</th>}<th>展區</th>{showInternal && <th>主辦內部編號</th>}<th>地圖狀態</th><th>操作</th></tr></thead>
      <tbody>{visible.slice(shownPage * size, (shownPage + 1) * size).map(({ key }) => {
        const { row, index } = byKey.get(key)!;
        const saved = coverageByScope.get(scopeKey(row.dayId, row.venueSpaceId)), coverage = coverageOf(row);
        const disabled = !editable || !!busy || conflict || refreshRequired;
        const cell = (field: RosterField, title: string, value: string, display?: string, options?: { value: string; label: string }[]) => <RosterCell key={field} focusKey={`${key}-${field}`} label={`${row.codes.join("、") || "新增攤位"} ${title}`} value={value} display={display} options={options} disabled={disabled} errors={errors.get(index)?.[field]}
          onRestore={() => update(key, row)} onChange={value => {
            if (field === "codes") update(key, { codes: value.split(/[、,，;；/\s]+/u) });
            else if (field === "venueSpaceId") {
              const assignment = assignments.find(item => item.venueSpaceId === value);
              update(key, { venueSpaceId: value, areaId: assignment?.areaMode === "none" ? "ALL" : assignment?.areaIds.length === 1 ? assignment.areaIds[0] : "" });
            } else update(key, { [field]: field === "stableKey" ? value || null : value });
          }} />;
        return <tr key={key} data-roster-key={key} data-changed={row !== baseline.get(key) || undefined}>
          {editable && <td><input type="checkbox" aria-label={`選取 ${row.codes.join("、") || "新增攤位"}`} disabled={disabled} checked={selected.includes(key)} onChange={event => setSelected(event.target.checked ? [...selected, key] : selected.filter(item => item !== key))} /></td>}
          {cell("codes", "攤位代碼", row.codes.join("、"))}{cell("circleName", "社團名稱", row.circleName)}
          {showDay && cell("dayId", "活動日", row.dayId, organizerDayLabel(days, row.dayId), days.map(item => ({ value: item.id, label: item.label })))}
          {showSpace && cell("venueSpaceId", "場地", row.venueSpaceId, organizerVenueSpaceLabel(detail.venueCatalog, row.venueSpaceId), assignments.map(item => ({ value: item.venueSpaceId, label: organizerVenueSpaceLabel(detail.venueCatalog, item.venueSpaceId) })))}
          {assignments.some(item => item.venueSpaceId === row.venueSpaceId && item.areaMode === "none") ? <td>無分區</td> : cell("areaId", "展區", row.areaId, areaLabel(row.venueSpaceId, row.areaId))}
          {showInternal && cell("stableKey", "主辦內部編號", row.stableKey ?? "")}
          <td>{coverage ? <><span>{coverage.label} {coverage.completed}/{coverage.total}</span>{row.codes.filter(code => saved?.drawn?.has(code)).map(code => <button type="button" className={styles.textButton} key={code} disabled={dirty || !!busy || conflict || refreshRequired} onClick={() => onLocate({ candidateId: detail.event.id, mapId: saved!.map.id, code, nonce: Date.now() })}>定位 {code}</button>)}</> : "尚未取得"}</td>
          <td><button type="button" className={styles.ghost} onClick={() => setAction({ kind: "details", key })}>明細</button>{editable && <><button type="button" className={styles.textButton} disabled={disabled || row.codes.length < 2 || entries.length >= 20_000 || errors.has(index)} onClick={() => { setSplitCodes([]); setAction({ kind: "split", key }); }}>拆分</button><button type="button" className={styles.textButton} disabled={disabled} onClick={() => setAction({ kind: "delete", key })}>刪除</button></>}</td>
        </tr>;
      })}</tbody></table>{visible.length === 0 && <p className={styles.emptyRoster}>沒有符合條件的攤位。</p>}</div>
    <div className={styles.rosterFooter}><div className={styles.row}>
      <label className={styles.rosterChoice}>每頁<select aria-label="每頁筆數" value={pageSize === "all" && visible.length > ALL_ROWS_LIMIT ? "100" : String(pageSize)} onChange={event => {
        const next: PageSize = event.target.value === "all" ? "all" : Number(event.target.value) as 25 | 50 | 100;
        // Stay on the stretch of the list already in view.
        setPageSize(next); setPage(next === "all" ? 0 : Math.floor(shownPage * size / next));
        try { localStorage.setItem(PAGE_SIZE_KEY, String(next)); } catch { /* The choice is a convenience; the list works without it. */ }
      }}>{[25, 50, 100].map(item => <option key={item} value={item}>{item} 筆</option>)}<option value="all" disabled={visible.length > ALL_ROWS_LIMIT}>{visible.length > ALL_ROWS_LIMIT ? `全部（${ALL_ROWS_LIMIT} 筆以內）` : "全部"}</option></select></label>
      {visible.length > 0 && <span>第 {(shownPage * size + 1).toLocaleString()}–{Math.min(visible.length, (shownPage + 1) * size).toLocaleString()} 筆，共 {visible.length.toLocaleString()} 筆</span>}
      <button type="button" className={styles.ghost} disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>上一頁</button><span>{shownPage + 1} / {pages}</span><button type="button" className={styles.ghost} disabled={shownPage + 1 >= pages} onClick={() => setPage(shownPage + 1)}>下一頁</button></div>
      {(dirty || needsAreaUpdate || conflict) && <div className={styles.row}><span>尚未儲存</span><button type="button" disabled={!editable || !!busy || conflict || refreshRequired || errors.size > 0 || !!limitError} onClick={() => void save()}>{busy === "save" ? "儲存中…" : "儲存變更"}</button><button type="button" className={styles.secondary} disabled={!!busy} onClick={() => setPending("discard")}>{busy === "reload" ? "重新讀取中…" : "放棄變更"}</button></div>}
    </div>
    {pending && <RosterDialog title="尚有未儲存變更" busy={!!busy} onClose={() => setPending(null)}><p>{pending === "discard" ? "放棄目前修改並重新讀取名單？" : "先儲存目前修改，再繼續操作。"}</p><div className={styles.row}>
      {pending !== "discard" && <button type="button" disabled={!!busy || conflict || errors.size > 0 || !!limitError} onClick={() => { void save().then(ok => { if (ok) perform(pending); }); }}>儲存並繼續</button>}
      <button type="button" className={styles.secondary} disabled={!!busy} onClick={() => { void discard().then(ok => { if (ok) perform(pending); }); }}>放棄變更</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={() => setPending(null)}>取消</button></div>{notice && <p role="status">{notice}</p>}</RosterDialog>}
    {aliasesOpen && <RosterDialog title="展區名稱" busy={!!busy} onClose={() => { if (aliasesDirty) setAliasCloseRequested(true); else setAliasesOpen(false); }}>
      <AreaNameFields detail={detail} spaces={assignments} labels={labels} disabled={!!busy || conflict} onChange={(spaceId, areaId, label) => { setNotice(""); setLabels(current => ({ ...current, [spaceId]: { ...current[spaceId], [areaId]: label } })); }} />
      {notice && <p role="status">{notice}</p>}<div className={styles.row}><button type="button" disabled={!aliasesDirty || !!busy || conflict} onClick={() => {
        setBusy("aliases"); setNotice("");
        const draft = { ...detail.draft, venue: { ...detail.draft.venue, assignments: assignments.map(assignment => {
          const names = { ...assignment.areaLabels, ...labels[assignment.venueSpaceId] };
          return { ...assignment, areaLabels: Object.fromEntries(Object.entries(names).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value)) };
        }) } };
        void saveOrganizerEvent(detail.event.id, expectedVersion, draft).then(async saved => {
          setExpectedVersion(saved.version); setWriteDraft(draft); setLabels({}); setAliasesOpen(false); setNotice("展區名稱已儲存。");
          try { await onChanged(); } catch (error) { setRefreshRequired(true); setNotice(`展區名稱已儲存，但重新讀取失敗：${message(error)}`); }
        }).catch(error => { setNotice(message(error)); if (error instanceof PortalError && error.status === 409) setConflict(true); }).finally(() => setBusy(null));
      }}>{busy === "aliases" ? "儲存中…" : "儲存展區名稱"}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={() => { setLabels({}); setAliasesOpen(false); }}>取消</button></div>
    </RosterDialog>}
    {aliasCloseRequested && <RosterDialog title="放棄展區名稱變更？" onClose={() => setAliasCloseRequested(false)}><div className={styles.row}><button type="button" onClick={() => { setLabels({}); setAliasesOpen(false); setAliasCloseRequested(false); }}>放棄變更</button><button type="button" className={styles.secondary} onClick={() => setAliasCloseRequested(false)}>繼續編輯</button></div></RosterDialog>}
    {action && <RosterDialog title={action.kind === "merge" ? "合併攤位" : `${action.kind === "details" ? "攤位明細" : action.kind === "split" ? "拆分攤位" : "刪除攤位"} · ${active?.row.codes.join("、") || "新增攤位"}`} onClose={() => setAction(null)}>
      {action.kind === "details" && active && <><p>{active.row.circleName}</p><dl><dt>來源列</dt><dd>{active.row.sourceRow || "手動新增／合併"}</dd><dt>主辦內部編號</dt><dd>{active.row.stableKey || "—"}</dd></dl>{suspiciousRosterCodes(active.row) && editable && <button type="button" disabled={!!busy || conflict || refreshRequired} onClick={() => {
        const width = suspiciousRosterCodes(active.row)!;
        update(active.key, { codes: active.row.codes.flatMap(code => [...code].length % width === 0 ? Array.from({ length: [...code].length / width }, (_, i) => [...code].slice(i * width, (i + 1) * width).join("")) : [code]) }); setAction(null);
      }}>確認每 {suspiciousRosterCodes(active.row)} 字拆成一碼</button>}</>}
      {action.kind === "delete" && active && <><p>刪除 {active.row.circleName || "這筆名單"}？儲存變更後生效。</p><button type="button" onClick={() => { change(entries.filter(entry => entry.key !== active.key)); setSelected(selected.filter(key => key !== active.key)); setAction(null); }}>確認刪除</button></>}
      {action.kind === "split" && active && <><p>選取要移到另一筆名單的代碼。</p><div className={styles.row}>{active.row.codes.map(code => <label key={code} className={styles.rosterChoice}><input type="checkbox" checked={splitCodes.includes(code)} onChange={event => setSplitCodes(event.target.checked ? [...splitCodes, code] : splitCodes.filter(item => item !== code))} />{code}</label>)}</div><button type="button" disabled={!splitCodes.length || splitCodes.length >= active.row.codes.length} onClick={() => {
        const split = splitRosterRow(active.row, splitCodes);
        const next = entries.flatMap(entry => entry.key === active.key ? [{ key: entry.key, row: split[0] }, { key: nextKey, row: split[1] }] : [entry]);
        change(next); setViewEntries(current => current.flatMap(entry => entry.key === active.key ? [entry, { key: nextKey, row: split[1] }] : [entry])); setNextKey(nextKey + 1); setAction(null);
      }}>確認拆分</button></>}
      {action.kind === "merge" && <><label>合併後保留的社團名稱<select value={mergeName} onChange={event => setMergeName(event.target.value)}><option value="">請選擇</option>{names.map(name => <option key={name}>{name}</option>)}</select></label><p>合併 {chosen.length} 筆，保留全部攤位代碼。</p><button type="button" disabled={!!mergeError || !mergeName} onClick={() => {
        const merged = mergeRosterRows(chosenRows, mergeName); if (!merged) return;
        change(entries.flatMap(entry => entry.key === chosen[0].key ? [{ ...entry, row: merged }] : selected.includes(entry.key) ? [] : [entry])); setSelected([]); setAction(null);
      }}>確認合併</button></>}
    </RosterDialog>}
  </section>;
}
