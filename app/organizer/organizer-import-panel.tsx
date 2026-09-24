/** 攤位匯入：欄位對應、預覽逐列修正、已存清單與場館目錄新增。
 *
 * 由 `organizer-app.tsx` 拆出（#224）。該檔原本是 1870 行的單檔，面板
 * 彼此無關卻共處一室，讀一個面板要先略過另外四個。
 */
import { createOrganizerVenue, createOrganizerVenueSpace, putOrganizerImport, saveOrganizerEvent, type OrganizerEventDetail, type OrganizerMapLocation } from "../organizer-client";
import { isOrganizerAreaId, withOrganizerImportedAreaIds } from "../organizer-event";
import { buildOrganizerImportMetadata, buildOrganizerImportSample, prepareOrganizerImport, suggestOrganizerBoothCodeWidth, toOrganizerCsv, type OrganizerImportFieldMapping, type OrganizerImportMapping, type OrganizerImportOverrideField, type OrganizerImportOverrides, type OrganizerRejectedImportRow } from "../organizer-import";
import { normalizeOrganizerVenueSourceUrl, type OrganizerVenueCatalogSpace, type OrganizerVenueCatalogVenue, type OrganizerVenueSpaceAreaMode } from "../organizer-venue-catalog";
import { readOrganizerWorkbook, type OrganizerWorkbookSheet } from "../organizer-workbook";
import { IDLE, message, organizerVenueSpaceLabel, type Notice } from "./organizer-shared";
import { SavedImportList } from "./organizer-roster-editor";
import { VenueLayerGuide } from "./organizer-venue-layers";
import styles from "./organizer.module.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionNotice, useActionFeedback } from "./organizer-feedback";

type MappingChoice = { column: number | null; fixed: string };
type ExcludedImportRow = { sourceRow: number; boothCode: string; circleName: string };

const MISSING_CODE: Record<OrganizerImportOverrideField, string> = {
  dayId: "missing_day", venueSpaceId: "missing_venue_space", areaId: "missing_area",
  boothCode: "missing_booth", circleName: "missing_circle", stableKey: "",
};


function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ImportPanel({ detail, onChanged, onSection, onDirtyChange, onSaveReady, onLocate }: {
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  onSection: (section: "venue") => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaveReady: (save: (() => Promise<boolean>) | null) => void;
  onLocate: (location: OrganizerMapLocation) => void;
}) {
  const [rosterDirty, setRosterDirty] = useState(false);
  const reportRosterDirty = useCallback((dirty: boolean) => { setRosterDirty(dirty); onDirtyChange(dirty); }, [onDirtyChange]);
  const [fileName, setFileName] = useState("");
  const { notice: loadNotice, fail: loadFailed } = useActionFeedback();
  const readFeedback = useActionFeedback();
  const saveFeedback = useActionFeedback();
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [sheets, setSheets] = useState<OrganizerWorkbookSheet[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const onlySpace = detail.draft.venue.assignments.length === 1 ? detail.draft.venue.assignments[0] : null;
  const onlyDay = detail.draft.event.days.length === 1 ? detail.draft.event.days[0] : null;
  const [day, setDay] = useState<MappingChoice>({ column: null, fixed: onlyDay?.id ?? "" });
  const [venueSpace, setVenueSpace] = useState<MappingChoice>({ column: null, fixed: onlySpace?.venueSpaceId ?? "" });
  const [area, setArea] = useState<MappingChoice>({ column: null, fixed: "" });
  const [boothColumn, setBoothColumn] = useState<number | null>(null);
  const [circleColumn, setCircleColumn] = useState<number | null>(null);
  const [boothCodeMode, setBoothCodeMode] = useState<"single" | "delimited" | "fixed-width">("single");
  const [boothCodeWidth, setBoothCodeWidth] = useState("");
  const [stableColumn, setStableColumn] = useState<number | null>(null);
  const [previewRequested, setPreviewRequested] = useState(false);
  const [overrides, setOverrides] = useState<OrganizerImportOverrides>({});
  const [excluded, setExcluded] = useState<readonly ExcludedImportRow[]>([]);
  const [metadata, setMetadata] = useState<Awaited<ReturnType<typeof buildOrganizerImportMetadata>> | null>(null);
  // A source row is a physical line in a CSV but a filtered index in a
  // worksheet, so another file, sheet or header row changes what every row
  // number means. Corrections keyed by those numbers cannot survive that.
  const forgetPreview = () => { setPreviewRequested(false); setOverrides({}); setExcluded([]); };

  const sourceLabel = detail.draft.officialSource.label;
  useEffect(() => {
    if (!bytes) { setMetadata(null); return; }
    let ignore = false;
    void buildOrganizerImportMetadata({ bytes, fileName, worksheet: sheetName === "CSV" ? null : sheetName, sourceDescription: sourceLabel })
      .then((result) => { if (!ignore) setMetadata(result); })
      .catch((error) => { if (!ignore) loadFailed(message(error)); });
    return () => { ignore = true; };
  }, [bytes, fileName, sheetName, sourceLabel, loadFailed]);

  const sheet = useMemo(() => sheets.find((item) => item.name === sheetName) ?? null, [sheets, sheetName]);
  const header = useMemo(() => sheet?.rows[headerRow - 1]?.cells ?? [], [sheet, headerRow]);
  const editable = detail.event.status === "draft" || detail.event.status === "changes_requested";
  const assignments = detail.draft.venue.assignments;
  const catalog = detail.venueCatalog;
  const days = detail.draft.event.days;
  const requiresAreaMapping = assignments.some((assignment) => assignment.areaMode !== "none");
  const areaModeByVenueSpace = useMemo(() => Object.fromEntries(assignments.map((assignment) => [
    assignment.venueSpaceId, assignment.areaMode ?? "imported",
  ])), [assignments]);
  const assignedSpaces = useMemo(() => assignments.map((assignment) => ({
    id: assignment.venueSpaceId,
    label: organizerVenueSpaceLabel(catalog, assignment.venueSpaceId),
    name: catalog.venues.flatMap((venue) => venue.spaces).find((space) => space.id === assignment.venueSpaceId)?.name,
  })), [assignments, catalog]);
  const venueSpaceValues = useMemo(() => {
    const nameCounts = new Map<string, number>();
    assignedSpaces.forEach(({ name }) => { if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1); });
    return Object.fromEntries(assignedSpaces.flatMap(({ id, label, name }) => [
      [id, id], [label, id], ...(name && nameCounts.get(name) === 1 ? [[name, id]] : []),
    ]));
  }, [assignedSpaces]);
  const dayValues = useMemo(() => Object.fromEntries(days.flatMap((item) => [[item.id, item.id], [item.label, item.id]])), [days]);

  const mapping = useMemo<OrganizerImportMapping | null>(() => {
    if (boothColumn === null || circleColumn === null) return null;
    const fieldMapping = (choice: MappingChoice, values?: Record<string, string>): OrganizerImportFieldMapping =>
      choice.column === null ? { fixed: choice.fixed } : { column: choice.column, ...(values ? { values } : {}) };
    return {
      day: fieldMapping(day, day.column === null ? undefined : dayValues),
      venueSpace: fieldMapping(venueSpace, venueSpace.column === null ? undefined : venueSpaceValues),
      ...(requiresAreaMapping ? { area: fieldMapping(area) } : {}),
      boothCode: { column: boothColumn }, circleName: { column: circleColumn },
      boothCodeMode, ...(boothCodeMode === "fixed-width" ? { boothCodeWidth: Number(boothCodeWidth) } : {}),
      ...(stableColumn === null ? {} : { stableKey: { column: stableColumn } }),
    };
  }, [day, venueSpace, area, boothColumn, circleColumn, stableColumn, requiresAreaMapping, dayValues, venueSpaceValues, boothCodeMode, boothCodeWidth]);

  const suggestedWidth = useMemo(() => sheet && boothColumn !== null
    ? suggestOrganizerBoothCodeWidth(sheet.rows.slice(headerRow).map((row) => String(row.cells[boothColumn] ?? ""))) : null,
  [sheet, boothColumn, headerRow]);
  const excludedRows = useMemo(() => excluded.map((row) => row.sourceRow), [excluded]);
  const prepared = useMemo(() => {
    if (!previewRequested || !sheet || !mapping) return null;
    // prepareOrganizerImport rejects an unusable header row by throwing. The
    // preview now recomputes as the organizer types, so that refusal is shown
    // in place instead of raised as one notice per keystroke.
    try {
      return { ok: true as const, ...prepareOrganizerImport({ rows: sheet.rows, headerRow, mapping, areaModeByVenueSpace, overrides, excludedRows }) };
    } catch (error) {
      return { ok: false as const, message: message(error) };
    }
  }, [previewRequested, sheet, headerRow, mapping, areaModeByVenueSpace, overrides, excludedRows]);
  const result = prepared?.ok ? prepared : null;

  const derived = useMemo(() => {
    const spaces = new Map<string, Map<string, number>>();
    for (const row of result?.rows ?? []) {
      const areas = spaces.get(row.venueSpaceId) ?? new Map<string, number>();
      areas.set(row.areaId, (areas.get(row.areaId) ?? 0) + 1);
      spaces.set(row.venueSpaceId, areas);
    }
    return [...spaces].map(([venueSpaceId, areas]) => ({
      venueSpaceId,
      declared: assignments.some((assignment) => assignment.venueSpaceId === venueSpaceId),
      areas: [...areas]
        .map(([id, rows]) => ({ id, rows, valid: isOrganizerAreaId(id) }))
        .sort((a, b) => a.id.localeCompare(b.id, "en")),
    })).sort((a, b) => a.venueSpaceId.localeCompare(b.venueSpaceId, "en"));
  }, [assignments, result]);
  const derivedBlocked = derived.some((space) => !space.declared || space.areas.some((area) => !area.valid));
  // Import replaces the whole booth list, so a configured space this file never
  // mentions ends up with no booths and no areas. That is legitimate mid-work,
  // but the organizer should see it here rather than meet it as an error after
  // saving.
  const uncovered = result
    ? assignments
      .filter((assignment) => !derived.some((space) => space.venueSpaceId === assignment.venueSpaceId))
      .map((assignment) => organizerVenueSpaceLabel(catalog, assignment.venueSpaceId))
    : [];

  const sample = useMemo(() => buildOrganizerImportSample({
    days: days.map((item) => ({ id: item.id, label: item.label })),
    spaces: assignedSpaces.map((space) => ({ id: space.id, label: space.label, divided: areaModeByVenueSpace[space.id] !== "none" })),
    requiresArea: requiresAreaMapping,
  }), [days, assignedSpaces, areaModeByVenueSpace, requiresAreaMapping]);

  const correct = (sourceRow: number, field: OrganizerImportOverrideField, value: string) => {
    saveFeedback.clear();
    setOverrides((current) => ({ ...current, [sourceRow]: { ...current[sourceRow], [field]: value } }));
  };
  const remove = (row: ExcludedImportRow) => {
    saveFeedback.clear();
    setExcluded((current) => [...current, { sourceRow: row.sourceRow, boothCode: row.boothCode, circleName: row.circleName }]);
  };
  const restore = (sourceRow: number) => {
    saveFeedback.clear();
    setExcluded((current) => current.filter((row) => row.sourceRow !== sourceRow));
  };

  const select = (label: string, value: MappingChoice, setValue: (value: MappingChoice) => void, fixedHint: string, fixedOptions?: Array<{ value: string; label: string }>) => <fieldset className={styles.mappingField}>
    <legend>{label}</legend>
    <div>
      <label className={styles.subLabel}>來源欄位
        <select value={value.column === null ? "fixed" : String(value.column)} onChange={(event) => setValue(event.target.value === "fixed" ? { ...value, column: null } : { ...value, column: Number(event.target.value) })}>
          <option value="fixed">所有列相同</option>
          {header.map((name, index) => <option value={index} key={index}>{index + 1}. {String(name || "（空白）")}</option>)}
        </select>
      </label>
      {value.column === null && <label className={styles.subLabel}>固定值
        {fixedOptions
          ? <select value={value.fixed} onChange={(event) => setValue({ ...value, fixed: event.target.value })}><option value="">請選擇</option>{fixedOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
          : <input placeholder={fixedHint} value={value.fixed} onChange={(event) => setValue({ ...value, fixed: event.target.value })} />}
      </label>}
    </div>
  </fieldset>;

  const dayOptions = days.map((item) => ({ value: item.id, label: `${item.id}・${item.label}` }));
  const spaceOptions = assignedSpaces.map((space) => ({ value: space.id, label: space.label }));
  const columns = requiresAreaMapping ? 8 : 7;
  /* 移除 exists to break a tie: the contract gives it one use, which is that a
   * duplicated booth can be resolved by taking the other row out. A row with
   * nothing wrong with it has no use for it, and 170 destructive buttons beside
   * 170 correct rows are noise and risk rather than an affordance (#225). */
  const flagged = new Set((result?.issues ?? []).map((issue) => issue.row).filter((row) => row !== undefined));

  return <section className={styles.panel} onChangeCapture={() => saveFeedback.clear()}>
    <ActionNotice notice={loadNotice} />
    <div className={styles.panelHead}><div><h3>攤位與社團名單匯入</h3><p>{detail.import ? "對照欄位後預覽結果，確認無誤再送出名單。" : "尚未加入攤位名單。選一個 CSV 或 Excel 檔，或先下載範本。"}</p></div>{detail.import && <span className={styles.version}>{detail.import.rows.length} 列・{detail.import.source.fileName}</span>}</div>
    {detail.import && <SavedImportList detail={detail} onChanged={onChanged} onDirtyChange={reportRosterDirty} onSaveReady={onSaveReady} onLocate={onLocate} />}
    {rosterDirty && <p role="status">先儲存或放棄清單變更，再以新檔案取代。</p>}
    <fieldset className={styles.formFields} disabled={saveFeedback.pending || rosterDirty} aria-label="匯入檔案與欄位對應">
    <div className={styles.importGrid}>
      <label>來源檔案<input type="file" disabled={!editable} accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        forgetPreview(); setBoothCodeMode("single"); setBoothCodeWidth("");
        void readFeedback.run(readOrganizerWorkbook(file).then((workbook) => {
          setFileName(file.name); setBytes(workbook.bytes); setSheets(workbook.sheets);
          setSheetName(workbook.sheets[0]?.name ?? ""); setHeaderRow(1);
          return workbook;
        }), (workbook) => `已讀取 ${workbook.sheets.length} 個工作表。`);
      }} /><ActionNotice notice={readFeedback.notice} /></label>
      <label>工作表<select disabled={sheets.length < 2} value={sheetName} onChange={(event) => { setSheetName(event.target.value); forgetPreview(); }}><option value="">尚未選擇</option>{sheets.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>
      <label>標題列<input type="number" min={1} max={sheet?.rows.length ?? 1} value={headerRow} onChange={(event) => { setHeaderRow(Number(event.target.value)); forgetPreview(); }} /><small>欄位名稱在第幾列。</small></label>
    </div>
    {!sheet ? <div className={styles.sample}>
      <h4>檔案長這樣</h4>
      <ImportSampleCard sample={sample} fileBase={detail.draft.event.id ?? "event"} />
    </div> : <details className={styles.sample}>
      <summary>查看填寫範例／下載範本</summary>
      <ImportSampleCard sample={sample} fileBase={detail.draft.event.id ?? "event"} />
    </details>}
    {sheet && <>
      <div className={styles.mappingGrid}>
        {select("活動日", day, setDay, "活動日代碼", dayOptions)}
        {select("場地", venueSpace, setVenueSpace, "場地", spaceOptions)}
        {/* The read-only card carries the same title, sub-label and value line
            as the pickers beside it, so the row reads as one row. */}
        {requiresAreaMapping ? <>{select("展區", area, setArea, "展區代碼")}
          {/* 展區 is a required column here, so an organizer whose list has no
              real one maps the nearest thing and ends up with rows as areas.
              The way out is a setting in another section, so it is offered
              where the problem is met rather than left to be discovered (#294). */}
          {/* Collapsed here: by this point the choice is already made, so this
              is something to check against rather than the first explanation. */}
          <div className={styles.mappingEscape}><VenueLayerGuide /></div>
          <p className={styles.mappingEscape}>這場活動沒有分區？把這個場地的展區方式改成「沒有分區」，就不需要對應這一欄。<button type="button" className={styles.textButton} onClick={() => onSection("venue")}>前往場館與場地</button></p>
        </> : <fieldset className={`${styles.derivedField} ${styles.mappingField}`}>
          <legend>展區</legend>
          <div><div className={styles.subLabel}>固定值<strong>無分區</strong></div></div>
          <small>不需要展區欄，系統會自動帶入。</small>
        </fieldset>}
        <ColumnSelect label="攤位代碼" value={boothColumn} header={header} required onChange={setBoothColumn} />
        <ColumnSelect label="社團名稱" value={circleColumn} header={header} required onChange={setCircleColumn} />
        <ColumnSelect label="主辦內部編號（選填）" value={stableColumn} header={header} onChange={setStableColumn} />
      </div>
      <div className={styles.importGrid}>
        <label>攤位代碼格式<select value={boothCodeMode} onChange={(event) => { setBoothCodeMode(event.target.value as typeof boothCodeMode); setBoothCodeWidth(""); }}>
          <option value="single">一列一個代碼</option><option value="delimited">用分隔符號分開（A01、A02）</option><option value="fixed-width">固定字元數連寫（A01A02）</option>
        </select>
        {/* A hint belongs under the control it is about; as its own grid cell
            it sat in the next column, level with nothing. */}
        {boothCodeMode === "delimited" && <small>支援空白、逗號、頓號、分號與斜線。</small>}
        {boothCodeMode === "single" && suggestedWidth !== null && <small role="status">名單可能含合併攤位；例如每 {suggestedWidth} 個字元為一碼。請核對格式再儲存。</small>}
        </label>
        {boothCodeMode === "fixed-width" && <label>每個代碼的字元數<input type="number" min={1} max={80} value={boothCodeWidth} onChange={(event) => setBoothCodeWidth(event.target.value)} />
          <small>請核對原始名單後填入；不會自動套用。</small>
          {suggestedWidth !== null && <button type="button" className={styles.ghost} onClick={() => setBoothCodeWidth(String(suggestedWidth))}>確認使用建議的 {suggestedWidth} 個字元</button>}
        </label>}
      </div>
      {/* 3.4: the preview is the confirmation step, so what confirming does is
          said here rather than behind another dialog. */}
      <p>{detail.import?.rows.length
        ? `這次匯入會取代目前已儲存的 ${detail.import.rows.length} 列攤位資料。`
        : "儲存後會以這次確認的資料取代目前的攤位名單。"}</p>
      <div className={styles.row}>
        <button type="button" disabled={!mapping || saveFeedback.pending} onClick={() => { readFeedback.clear(); saveFeedback.clear(); setPreviewRequested(true); }}>預覽對應結果</button>
        <button type="button" className={styles.ghost} disabled={saveFeedback.pending || !result || !metadata || !mapping || result.rows.length === 0 || derivedBlocked || result.rejected.length > 0} onClick={() => {
          if (!result || !metadata || !mapping) return;
          readFeedback.clear();

          // The areas this file names are written to the draft first, because
          // the import API refuses any row whose area the event never declared
          // — and this file is where those areas come from.
          const withAreas = withOrganizerImportedAreaIds(detail.draft, result.rows);
          const declared = JSON.stringify(withAreas) === JSON.stringify(detail.draft)
            ? Promise.resolve(detail.event.version)
            : saveOrganizerEvent(detail.event.id, detail.event.version, withAreas).then((saved) => saved.version);
          void saveFeedback.run(declared.then((expectedVersion) => putOrganizerImport(detail.event.id, {
            expectedVersion, source: { ...metadata, mapping }, rows: result.rows,
          })).then(onChanged), "匯入資料已儲存；原始檔沒有上傳。");
        }}>{saveFeedback.pending ? "儲存中…" : `確認並儲存 ${result?.rows.length ?? 0} 列`}</button>
        <ActionNotice notice={saveFeedback.notice} />
        {(Object.keys(overrides).length > 0 || excluded.length > 0) && <button type="button" className={styles.textButton} onClick={() => { saveFeedback.clear(); setOverrides({}); setExcluded([]); }}>清除所有手動修改</button>}
      </div>
      {prepared && !prepared.ok && <p className={styles.issueError}>{prepared.message}</p>}
      {result && <div className={styles.importPreview}>
        <div className={styles.validationSummary}><b>{result.rows.length} 列 → {result.boothCount} 個攤位代碼</b><span>{result.rejected.length} 列待修正</span><span>{excluded.length} 列已移除</span></div>
        {derived.length > 0 && <div className={styles.derivedSummary}>
          <h4>這份檔案裡的場地與展區</h4>
          {derived.map((space) => <div key={space.venueSpaceId} className={space.declared ? undefined : styles.issueError}>
            <strong>{organizerVenueSpaceLabel(catalog, space.venueSpaceId)}</strong>
            {space.declared
              ? <span>{space.areas.map((area) => `${areaModeByVenueSpace[space.venueSpaceId] === "none" ? "無分區" : area.id}（${area.rows} 列）${area.valid ? "" : "・代碼不可用"}`).join("、")}</span>
              : <span>這個場地不在活動設定裡，請先到「場館與場地」新增，或修正來源檔。</span>}
          </div>)}
          {derived.some((space) => space.areas.some((area) => !area.valid)) && <p className={styles.issueError}>展區代碼只能使用英數字、底線與連字號，請修正來源檔的展區欄。</p>}
          {uncovered.length > 0 && <p className={styles.issueWarning}>{uncovered.join("、")} 沒有出現在這份檔案；儲存後這些場地會變成沒有攤位。</p>}
          <p>儲存時會把分區場地的展區寫進活動設定；無分區的場地不需要展區欄。沒出現在檔案裡的場地會標示為未匯入。</p>
        </div>}
        {result.issues.filter((issue) => issue.severity === "warning").slice(0, 10).map((issue) => <p key={`${issue.code}-${issue.row}`} role="status">{issue.message}</p>)}
        <table>
          <thead><tr><th>來源列</th><th>活動日</th><th>場地</th>{requiresAreaMapping && <th>展區</th>}<th>攤位</th><th>社團</th><th>主辦內部編號</th><th /></tr></thead>
          {result.rejected.length > 0 && <tbody>
            <tr className={styles.rowGroup}><td colSpan={columns}>待修正 {result.rejected.length} 列<span>填好標記的欄位，這一列就會移到可匯入。</span></td></tr>
            {result.rejected.slice(0, 100).map((row) => <RejectedImportRow key={row.sourceRow} row={row} columns={columns}
              dayOptions={dayOptions} spaceOptions={spaceOptions} requiresArea={requiresAreaMapping} areaModeByVenueSpace={areaModeByVenueSpace}
              overrides={overrides[row.sourceRow]}
              duplicate={result.issues.find((issue) => issue.severity === "error" && issue.row === row.sourceRow)?.message ?? null}
              onCorrect={(field, value) => correct(row.sourceRow, field, value)} onRemove={() => remove(row)} />)}
          </tbody>}
          <tbody>
            <tr className={styles.rowGroup}><td colSpan={columns}>可匯入 {result.rows.length} 列</td></tr>
            {result.rows.slice(0, 100).map((row) => <tr key={row.sourceRow}>
              <td>{row.sourceRow}</td><td>{row.dayId}</td><td>{organizerVenueSpaceLabel(catalog, row.venueSpaceId)}</td>
              {requiresAreaMapping && <td>{areaModeByVenueSpace[row.venueSpaceId] === "none" ? "無分區" : row.areaId}</td>}
              <td>{row.codes.join("、")}</td><td>{row.circleName}</td><td>{row.stableKey ?? "—"}</td>
              <td className={styles.rowAction}>{flagged.has(row.sourceRow)
                && <button type="button" className={styles.ghost} onClick={() => remove({ ...row, boothCode: row.codes.join("、") })}>移除</button>}</td>
            </tr>)}
          </tbody>
          {excluded.length > 0 && <tbody>
            <tr className={styles.rowGroup}><td colSpan={columns}>已移除 {excluded.length} 列</td></tr>
            {excluded.slice(0, 100).map((row) => <tr key={row.sourceRow} className={styles.excludedRow}>
              <td>{row.sourceRow}</td><td colSpan={requiresAreaMapping ? 3 : 2} />
              <td>{row.boothCode}</td><td>{row.circleName}</td><td />
              <td className={styles.rowAction}><button type="button" className={styles.ghost} onClick={() => restore(row.sourceRow)}>復原</button></td>
            </tr>)}
          </tbody>}
        </table>
        {result.rejected.length > 0 && <div className={styles.sampleActions}>
          <button type="button" className={styles.secondary} onClick={() => setExcluded((current) => [
            ...current,
            ...result.rejected.map((row) => ({ sourceRow: row.sourceRow, boothCode: row.boothCode, circleName: row.circleName })),
          ])}>略過全部待修正的列</button>
          <p>待修正的列先顯示 100 列；略過會套用到全部。</p>
        </div>}
        {(result.rows.length > 100 || result.rejected.length > 100) && <p>每一組先顯示 100 列；儲存時會包含全部確認列。</p>}
      </div>}
    </>}
    </fieldset>
  </section>;
}

function RejectedImportRow({ row, columns, dayOptions, spaceOptions, requiresArea, areaModeByVenueSpace, overrides, duplicate, onCorrect, onRemove }: {
  row: OrganizerRejectedImportRow;
  columns: number;
  dayOptions: Array<{ value: string; label: string }>;
  spaceOptions: Array<{ value: string; label: string }>;
  requiresArea: boolean;
  areaModeByVenueSpace: Record<string, OrganizerVenueSpaceAreaMode>;
  overrides: Readonly<Partial<Record<OrganizerImportOverrideField, string>>> | undefined;
  duplicate: string | null;
  onCorrect: (field: OrganizerImportOverrideField, value: string) => void;
  onRemove: () => void;
}) {
  const shown = (field: OrganizerImportOverrideField, fallback: string) => overrides?.[field] ?? fallback;
  // Corrections commit on blur rather than on every keystroke: the import model
  // collapses whitespace, which would eat the space still being typed.
  const cell = (field: OrganizerImportOverrideField, fallback: string, label: string) =>
    <td className={row.codes.includes(MISSING_CODE[field]) ? styles.issueCell : undefined}>
      <input aria-label={`來源列 ${row.sourceRow} 的${label}`} defaultValue={shown(field, fallback)}
        onBlur={(event) => onCorrect(field, event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
    </td>;
  const choice = (field: "dayId" | "venueSpaceId", fallback: string, label: string, options: Array<{ value: string; label: string }>) => {
    const current = shown(field, fallback);
    return <td className={row.codes.includes(MISSING_CODE[field]) ? styles.issueCell : undefined}>
      <select aria-label={`來源列 ${row.sourceRow} 的${label}`} value={current} onChange={(event) => onCorrect(field, event.target.value)}>
        <option value="">尚未選擇</option>
        {/* A value the file supplied but the event never declared stays visible rather than reading as an empty cell. */}
        {current && !options.some((option) => option.value === current) && <option value={current}>{current}</option>}
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </td>;
  };
  return <>
    <tr className={styles.issueRow}>
      <td>{row.sourceRow}</td>
      {choice("dayId", row.dayId, "活動日", dayOptions)}
      {choice("venueSpaceId", row.venueSpaceId, "場地", spaceOptions)}
      {requiresArea && (areaModeByVenueSpace[row.venueSpaceId] === "none" ? <td>無分區</td> : cell("areaId", row.areaId, "展區"))}
      {cell("boothCode", row.boothCode, "攤位代碼")}
      {cell("circleName", row.circleName, "社團名稱")}
      <td>{row.stableKey ?? "—"}</td>
      <td className={styles.rowAction}><button type="button" className={styles.ghost} onClick={onRemove}>移除</button></td>
    </tr>
    {duplicate && <tr className={styles.duplicateNote}><td colSpan={columns}>{duplicate}</td></tr>}
  </>;
}

function ColumnSelect({ label, value, header, required = false, onChange }: {
  label: string; value: number | null; header: readonly unknown[]; required?: boolean; onChange: (value: number | null) => void;
}) {
  return <label className={styles.mappingField}>{label}<select required={required} value={value === null ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}><option value="">尚未選擇</option>{header.map((name, index) => <option value={index} key={index}>{index + 1}. {String(name || "（空白）")}</option>)}</select></label>;
}

/** What this file is supposed to look like. It used to vanish the moment a
 * file was picked, which is exactly when the columns are being matched against
 * it. Two downloads, because a blank sheet to fill in and a worked example to
 * read are different needs (#221 3.2, 3.3). */
function ImportSampleCard({ sample, fileBase }: { sample: { header: string[]; rows: string[][] }; fileBase: string }) {
  return <>
    <p>每列填一個攤位。主辦內部編號可留空。活動日與場地請使用本活動的值；欄位順序可以不同，選好檔案後再對應。</p>
    <div className={styles.sampleTable}>
      <table><thead><tr>{sample.header.map((name) => <th key={name}>{name}</th>)}</tr></thead>
        <tbody>{sample.rows.map((row) => <tr key={row.join("/")}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table>
    </div>
    <div className={styles.sampleActions}>
      <button type="button" className={styles.secondary} onClick={() => downloadText(`${fileBase}-攤位名單.csv`, toOrganizerCsv([sample.header]), "text/csv;charset=utf-8")}>下載空白 CSV</button>
      <button type="button" className={styles.ghost} onClick={() => downloadText(`${fileBase}-攤位名單填寫範例.csv`, toOrganizerCsv([sample.header, ...sample.rows]), "text/csv;charset=utf-8")}>下載填寫範例</button>
    </div>
    <p>主辦內部編號留空也可以匯入，供主辦自行核對，不代表跨活動社團識別。</p>
  </>;
}
export function VenueCatalogCreator({ candidateId, venue, onCreated, onCancel }: {
  candidateId: string;
  venue: OrganizerVenueCatalogVenue | null;
  onCreated: (venue: OrganizerVenueCatalogVenue | null, space: OrganizerVenueCatalogSpace) => void;
  onCancel: () => void;
}) {
  const [venueName, setVenueName] = useState("");
  const [venueUrl, setVenueUrl] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [spaceUrl, setSpaceUrl] = useState("");
  const [defaultAreaMode, setDefaultAreaMode] = useState<OrganizerVenueSpaceAreaMode>("imported");
  const [notice, setLocalNotice] = useState<Notice>(IDLE);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /* 「全館」 rarely has a page of its own, and an organizer usually has one
   * official address. Leaving the space blank inherits the venue's URL
   * instead of asking for the same thing twice; the row still carries an
   * official HTTPS source, which is what the contract asks for (#219). */
  const inheritedUrl = venue?.sourceUrl ?? venueUrl.trim();
  /* noValidate because the browser bubble is not this app's error surface:
   * every other field on this page answers inline, under the field it is
   * about. Owning the check here means owning all five, not two. */
  return <form className={styles.catalogCreator} noValidate onSubmit={(event) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!venue) {
      if (!venueName.trim()) errors.venueName = "請填寫場館名稱。";
      const source = normalizeOrganizerVenueSourceUrl(venueUrl);
      if (!source) errors.venueUrl = source === undefined ? "場館官方網址必須是 https:// 開頭的網址。" : "請填寫場館官方網址。";
      if (!venueAddress.trim()) errors.venueAddress = "請填寫場館地址。";
    }
    if (!spaceName.trim()) errors.spaceName = "請填寫場地名稱。";
    if (normalizeOrganizerVenueSourceUrl(spaceUrl) === undefined) {
      errors.spaceUrl = "場地官方網址必須是 https:// 開頭的網址；留空會沿用場館網址。";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) { setLocalNotice(IDLE); return; }
    setLocalNotice({ kind: "busy", message: "建立中…" });
    const action = venue
      ? createOrganizerVenueSpace(candidateId, venue.id, { name: spaceName, sourceUrl: spaceUrl, defaultAreaMode })
        .then(({ space }) => ({ venue: null, space }))
      : createOrganizerVenue(candidateId, {
        name: venueName,
        sourceUrl: venueUrl,
        address: venueAddress,
        initialSpace: { name: spaceName, sourceUrl: spaceUrl, defaultAreaMode },
      }).then(({ venue: created, space }) => ({ venue: { ...created, spaces: [space] }, space }));
    void action.then(({ venue: created, space }) => {
      setLocalNotice({ kind: "ok", message: "已建立並選取。" });
      onCreated(created, space);
    }).catch((error) => setLocalNotice({ kind: "error", message: message(error) }));
  }}>
    <div className={styles.panelHead}><div><h4>{venue ? `新增 ${venue.name} 的場地` : "建立新場館"}</h4><p>建立後會立即出現在下方選單中。</p></div></div>
    <div className={styles.formGrid}>
      {!venue && <>
        <label>場館名稱<input maxLength={120} aria-invalid={fieldErrors.venueName ? true : undefined} value={venueName} onChange={(event) => setVenueName(event.target.value)} />{fieldErrors.venueName && <small className={styles.fieldError}>{fieldErrors.venueName}</small>}</label>
        <label>場館官方網址<input type="url" placeholder="https://" aria-invalid={fieldErrors.venueUrl ? true : undefined} value={venueUrl} onChange={(event) => setVenueUrl(event.target.value)} />{fieldErrors.venueUrl && <small className={styles.fieldError}>{fieldErrors.venueUrl}</small>}</label>
        <label>場館地址<input maxLength={200} aria-invalid={fieldErrors.venueAddress ? true : undefined} value={venueAddress} onChange={(event) => setVenueAddress(event.target.value)} />
          {fieldErrors.venueAddress ? <small className={styles.fieldError}>{fieldErrors.venueAddress}</small> : <small>貼上場館官方網站上的完整地址。</small>}</label>
      </>}
      <label>場地名稱<input maxLength={120} placeholder="例如：全館、1F 展場" aria-invalid={fieldErrors.spaceName ? true : undefined} value={spaceName} onChange={(event) => setSpaceName(event.target.value)} />{fieldErrors.spaceName && <small className={styles.fieldError}>{fieldErrors.spaceName}</small>}</label>
      <label>場地官方網址（選填）<input type="url" placeholder="https://" aria-invalid={fieldErrors.spaceUrl ? true : undefined} value={spaceUrl} onChange={(event) => setSpaceUrl(event.target.value)} />
        {fieldErrors.spaceUrl
          ? <small className={styles.fieldError}>{fieldErrors.spaceUrl}</small>
          : <small>{inheritedUrl ? `留空沿用場館網址：${inheritedUrl}` : "留空沿用場館官方網址，不必重打一次。"}</small>}</label>
      <label>新活動的預設展區方式<select value={defaultAreaMode} onChange={(event) => setDefaultAreaMode(event.target.value as OrganizerVenueSpaceAreaMode)}>
        <option value="imported">由攤位名單帶入展區</option><option value="none">無分區</option>
      </select></label>
    </div>
    <div className={styles.row}><button type="submit" disabled={notice.kind === "busy"}>{venue ? "新增並選取" : "建立並選取"}</button><button type="button" className={styles.ghost} onClick={onCancel}>取消</button></div>
    {notice.message && <p className={notice.kind === "error" ? styles.issueError : undefined}>{notice.message}</p>}
  </form>;
}
