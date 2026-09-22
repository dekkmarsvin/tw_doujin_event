/** 地圖面板：底圖、版面編輯、儲存與確認對話框。
 *
 * 由 `organizer-app.tsx` 拆出（#224）。該檔原本是 1870 行的單檔，面板
 * 彼此無關卻共處一室，讀一個面板要先略過另外四個。
 */
import { createBlankEventMapLayout, type EventMapLayout } from "../event-map";
import { EMPTY_MAP_AUTHORING, type MapAuthoringState } from "../map-authoring-state";
import { MAP_IMAGE_MAX_BYTES } from "../map-contribution-files";
import MapLayoutEditor, { type MapEditorFocusTarget } from "../map-layout-editor";
import { resolveCandidateAuthoringScope } from "../event-authoring-scope";
import { hasMapTemplateRecognizer, recognizeMapTemplate } from "../map-template-registry";
import { createOrganizerMap, listOrganizerMaps, readOrganizerMap, readOrganizerMapBackground, saveOrganizerMap, uploadOrganizerMapBackground, type OrganizerEventDetail, type OrganizerMapDetail, type OrganizerMapSummary, type OrganizerMapLocation } from "../organizer-client";

import { useModalFocus } from "../use-modal-focus";
import { message, organizerDayLabel, organizerVenueSpaceLabel } from "./organizer-shared";
import styles from "./organizer.module.css";
import { ActionNotice, useActionFeedback } from "./organizer-feedback";

const MAP_PLAN_TYPES = ["image/jpeg", "image/png", "image/webp"];
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function layoutHasContent(layout: EventMapLayout | null) {
  return !!layout && (layout.rows.length > 0 || layout.pillars.length > 0
    || layout.accessPoints.length > 0 || layout.landmarks.length > 0);
}

/** One dialog for every action that would take what is on the canvas away. The
 * close dialog below stays separate because it offers a third answer — saving
 * first — and these do not: there is nothing to save on the way to discarding. */
function MapConfirmDialog({ confirm, onConfirm, onCancel }: {
  confirm: { title: string; description: string; confirmLabel: string };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLElement | null>(null);
  useModalFocus(true, dialog, onCancel);
  return <div className={styles.dialogBackdrop}>
    <section ref={dialog} className={styles.navigationDialog} role="dialog" aria-modal="true"
      aria-labelledby="map-confirm-title" aria-describedby="map-confirm-description" tabIndex={-1}>
      <h3 id="map-confirm-title">{confirm.title}</h3>
      <p id="map-confirm-description">{confirm.description}</p>
      <div className={styles.dialogActions}>
        <button type="button" onClick={onConfirm}>{confirm.confirmLabel}</button>
        <button type="button" className={styles.ghost} onClick={onCancel}>取消</button>
      </div>
    </section>
  </div>;
}

/** The plan is drawn from a data URL rather than an object URL because the
 * organizer page's `img-src` admits `data:` and not `blob:`. Reading a stored
 * plan therefore ends here too, not at `URL.createObjectURL`. */
function imageDataUrl(file: Blob) {
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

export function OrganizerMapPanel({ detail, onChanged, onSection, location }: {
  detail: OrganizerEventDetail;
  onChanged: () => Promise<void>;
  onSection: (section: "import") => void;
  location: OrganizerMapLocation | null;
}) {
  const [maps, setMaps] = useState<OrganizerMapSummary[]>([]);
  const [selected, setSelected] = useState<OrganizerMapDetail | null>(null);
  const [periodKey, setPeriodKey] = useState(detail.draft.event.days[0]?.id ?? "");
  const [venueSpaceId, setVenueSpaceId] = useState(detail.draft.venue.assignments[0]?.venueSpaceId ?? "");
  const [layout, setLayout] = useState<EventMapLayout | null>(null);
  const [focusTarget, setFocusTarget] = useState<MapEditorFocusTarget | null>(null);
  const [authoring, setAuthoring] = useState<MapAuthoringState>(EMPTY_MAP_AUTHORING);
  const [background, setBackground] = useState("");
  // A plan picked before the map exists has nowhere to be stored yet, so it
  // waits here and goes up with the first save.
  const [pendingBackground, setPendingBackground] = useState<File | null>(null);
  // The editor reports every committed edit, so one flag is enough to know
  // whether closing would throw work away. Undoing back to the opened state
  // still counts as edited, which errs towards asking.
  const [edited, setEdited] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // Three actions, three places to answer: loading the panel, taking a plan
  // image, and saving the map. They used to share one line above the section
  // switcher, so "地圖已儲存，尚未公開。" was still there two steps later (#220).
  const { notice: loadNotice, fail: loadFailed } = useActionFeedback();
  const planFeedback = useActionFeedback();
  const [saveResult, setSaveResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingMap, setSavingMap] = useState(false);
  const [confirm, setConfirm] = useState<
    { title: string; description: string; confirmLabel: string; run: () => void } | null
  >(null);
  // The editor stays open across saves, so the version the next save must send
  // comes from the last response rather than from a remount with fresh props.
  const [expectedVersion, setExpectedVersion] = useState(detail.event.version);
  const closeDialog = useRef<HTMLElement | null>(null);
  useModalFocus(confirmingClose, closeDialog, () => setConfirmingClose(false));
  const editable = detail.event.status === "draft" || detail.event.status === "changes_requested";
  const assignment = detail.draft.venue.assignments.find((item) => item.venueSpaceId === venueSpaceId);
  // A map is drawn against a booth list; without one there is nothing to draw.
  const importedRows = detail.import?.rows.filter((row) => row.dayId === periodKey && row.venueSpaceId === venueSpaceId).length ?? 0;
  const scope = useMemo(() => {
    const rows = detail.import?.rows ?? [];
    const resolved = resolveCandidateAuthoringScope({ candidateId: detail.event.id, draft: detail.draft, importedRows: rows }, periodKey, venueSpaceId);
    return resolved ? { ...resolved, groups: rows.filter(row => row.dayId === periodKey && row.venueSpaceId === venueSpaceId).map(row => ({ codes: row.codes, circleName: row.circleName })) } : null;
  }, [detail.event.id, detail.draft, detail.import, periodKey, venueSpaceId]);
  const reload = useCallback(async () => setMaps((await listOrganizerMaps(detail.event.id)).maps), [detail.event.id]);
  useEffect(() => { queueMicrotask(() => { void reload().catch((error) => loadFailed(message(error))); }); }, [reload, loadFailed]);

  // A map that was never saved is entirely unsaved, edits or not: one built
  // from a plan and not touched since is still only on this screen.
  const unsaved = edited || (!!layout && !selected);

  /** Every way of putting something else on the canvas asks first when there is
   * something on it that is not stored anywhere. Nothing to lose goes straight
   * through — a saved map reopened and not touched is already on the server. */
  const discarding = (run: () => void) => {
    if (!unsaved) { run(); return; }
    setConfirm({
      title: "尚有未儲存變更",
      description: "這張地圖有還沒儲存的變更，換過去就會丟掉。",
      confirmLabel: "放棄變更",
      run,
    });
  };

  const open = useCallback(async (map: Pick<OrganizerMapSummary, "id">) => {
    const next = (await readOrganizerMap(detail.event.id, map.id)).map;
    setFocusTarget(null);
    setSelected(next); setPeriodKey(next.periodKey); setVenueSpaceId(next.venueSpaceId);
    // Cleared before the read, not after: a failed read must not leave the map
    // that was open a moment ago showing its plan behind this one.
    setLayout(next.layout); setAuthoring(next.authoring ?? EMPTY_MAP_AUTHORING); setPendingBackground(null); setEdited(false); setBackground("");
    const plan = await readOrganizerMapBackground(detail.event.id, map.id);
    if (plan) setBackground(await imageDataUrl(plan));
  }, [detail.event.id]);
  useEffect(() => {
    if (!location || location.candidateId !== detail.event.id) return;
    let ignore = false;
    queueMicrotask(() => {
      if (ignore) return;
      void open({ id: location.mapId }).then(() => {
        if (!ignore) setFocusTarget({ kind: "slot", ref: location.code, nonce: location.nonce });
      }).catch(error => { if (!ignore) loadFailed(message(error)); });
    });
    return () => { ignore = true; };
  }, [location, detail.event.id, open, loadFailed]);
  const startBlank = () => {
    if (!assignment) return;
    const blank = () => {
      setSelected(null); setPendingBackground(null); setEdited(false); setBackground("");
      setLayout(createBlankEventMapLayout(assignment.mapTemplate, 1600, 1000)); setAuthoring(EMPTY_MAP_AUTHORING);
    };
    if (!layoutHasContent(layout) && authoring.guides.length === 0 && !background) { blank(); return; }
    setConfirm({
      title: "空白畫布會清掉畫面上的內容",
      description: selected
        ? "畫面上的地圖、輔助線與配置圖會清掉，已儲存的那份地圖還在。"
        : "畫面上的地圖、輔助線與配置圖會清掉，這張地圖還沒有儲存過。",
      confirmLabel: "清空重來",
      run: blank,
    });
  };
  /** The plan a map is traced from is stored with the map, so re-opening a
   * saved map brings it back on its own. With a map already open this only
   * changes the plan behind it; building a layout from the image — by
   * recognition or as a blank sheet its size — belongs to the empty editor,
   * where there is no work to lose. */
  const runFile = async (file: File) => {
    if (!assignment) throw new Error("請先選擇場館空間。");
    if (file.size > MAP_IMAGE_MAX_BYTES || !MAP_PLAN_TYPES.includes(file.type)) {
      throw new Error("配置圖需為 JPG、PNG 或 WebP，且不可超過 10MB。");
    }
    const source = await imageDataUrl(file);
    const image = await loadOrganizerMapImage(source);
    // A map built from the image is a new map, so the upload that follows can
    // only wait for the first save even if another map was open a moment ago.
    const target = layout ? selected : null;
    let traced = "";
    if (!layout) {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("瀏覽器無法建立圖片分析畫布。");
      context.drawImage(image, 0, 0);
      const recognizes = hasMapTemplateRecognizer(assignment.mapTemplate);
      const next = recognizes
        ? recognizeMapTemplate(assignment.mapTemplate, context.getImageData(0, 0, canvas.width, canvas.height)).layout
        : createBlankEventMapLayout(assignment.mapTemplate, canvas.width, canvas.height);
      setSelected(null); setLayout(next); setAuthoring(EMPTY_MAP_AUTHORING); setEdited(false);
      traced = recognizes ? "已套用地圖模板辨識結果。" : "此地圖模板沒有自動辨識，已建立手動編輯底圖。";
    }
    // The plan is only put on the canvas once it is somewhere it will survive:
    // stored now for a map that exists, and waiting for the first save for one
    // that does not. A failed upload therefore changes nothing on screen.
    if (target) {
      await uploadOrganizerMapBackground(detail.event.id, target.id, file);
      setBackground(source);
      return `${traced}配置圖已儲存。`;
    }
    setBackground(source);
    setPendingBackground(file);
    return `${traced}儲存地圖時會一起存下配置圖。`;
  };

  const closeEditor = () => {
    setConfirmingClose(false); setEdited(false); setPendingBackground(null);
    setLayout(null); setAuthoring(EMPTY_MAP_AUTHORING); setSelected(null); setBackground("");
  };

  /** Saving leaves the editor open, because a map takes several sittings and
   * closing it is a separate decision. What that costs is bookkeeping: the
   * candidate and the map both move on a version, and the next save has to send
   * the new ones. A first save also stops being a creation — from then on the
   * same editor is updating the map it just made, not making another. */
  const saveMap = async (close = false) => {
    if (!layout) return;
    setConfirmingClose(false);
    setSavingMap(true);
    try {
      let saved: OrganizerMapDetail;
      if (selected) {
        const result = await saveOrganizerMap(detail.event.id, selected.id, { expectedVersion, expectedMapRevision: selected.mapRevision, layout, authoring });
        setExpectedVersion(result.version);
        saved = { ...selected, mapRevision: result.mapRevision, layout, authoring };
      } else {
        const created = await createOrganizerMap(detail.event.id, { expectedVersion, periodKey, venueSpaceId, layout, authoring });
        setExpectedVersion(created.version);
        saved = (await readOrganizerMap(detail.event.id, created.draftId)).map;
      }
      // The plan the map is being traced from goes up with it. Saying which of
      // the two failed matters: the layout is already stored by this point, so
      // pressing save again is about the plan and nothing else.
      if (pendingBackground) {
        try {
          await uploadOrganizerMapBackground(detail.event.id, saved.id, pendingBackground);
          setPendingBackground(null);
        } catch (error) {
          throw new Error(`地圖已儲存，但配置圖沒有存上：${message(error)}`);
        }
      }
      if (close) closeEditor();
      else { setSelected(saved); setEdited(false); }
      await onChanged();
      await reload();
      setSaveResult({ ok: true, text: "地圖已儲存，尚未公開。" });
    } catch (error) {
      setSaveResult({ ok: false, text: message(error) });
    } finally {
      setSavingMap(false);
    }
  };

  return <section className={`${styles.panel} ${styles.mapPanel}`}>
    <ActionNotice notice={loadNotice} />
    <div className={styles.panelHead}><div><h3>各活動日的場館空間地圖</h3><p>每個活動日的每個場館空間各一張地圖。</p></div><span className={styles.version}>{maps.length} 張地圖</span></div>
    <div className={styles.mapToolbar}>
      <label>活動日<select value={periodKey} disabled={!!selected} onChange={(event) => {
        const next = event.target.value;
        discarding(() => { setPeriodKey(next); setLayout(null); setAuthoring(EMPTY_MAP_AUTHORING); setPendingBackground(null); setBackground(""); });
      }}>{detail.draft.event.days.map((day) => <option value={day.id} key={day.id}>{day.label}</option>)}</select></label>
      <label>使用空間<select value={venueSpaceId} disabled={!!selected} onChange={(event) => {
        const next = event.target.value;
        discarding(() => { setVenueSpaceId(next); setLayout(null); setAuthoring(EMPTY_MAP_AUTHORING); setPendingBackground(null); setBackground(""); });
      }}>{detail.draft.venue.assignments.map((item) => <option value={item.venueSpaceId} key={item.venueSpaceId}>{organizerVenueSpaceLabel(detail.venueCatalog, item.venueSpaceId)}</option>)}</select></label>
      <button type="button" className={styles.ghost} disabled={!editable || !assignment} onClick={startBlank}>空白畫布</button>
      <label className={styles.fileButton}>{!layout ? "上傳配置圖並編輯" : background ? "更換配置圖" : "上傳配置圖"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!editable || !assignment} onChange={(event) => {
        const file = event.target.files?.[0];
        // Cleared so picking the same plan again still counts as a change,
        // which is what putting one map's plan behind the next one takes.
        event.target.value = "";
        if (!file) return;
        const load = () => {
          void planFeedback.run(runFile(file), (done) => done);
        };
        if (!background) { load(); return; }
        setConfirm({
          title: "已經有配置圖",
          description: "換成剛選的這張，原本那張就不會留著。",
          confirmLabel: "換成新的",
          run: load,
        });
      }} /><ActionNotice notice={planFeedback.notice} /></label>
      <label>從同場館空間複製<select value="" onChange={(event) => {
        const map = maps.find((item) => item.id === event.target.value);
        if (!map) return;
        discarding(() => {
          void readOrganizerMap(detail.event.id, map.id).then(({ map: source }) => {
            setSelected(null); setPeriodKey(periodKey); setLayout(structuredClone(source.layout)); setAuthoring(structuredClone(source.authoring ?? EMPTY_MAP_AUTHORING));
            setPendingBackground(null); setBackground(""); setEdited(false);
          }).catch((error) => loadFailed(message(error)));
        });
      }}><option value="">選擇既有地圖</option>{maps.filter((item) => item.venueSpaceId === venueSpaceId && item.periodKey !== periodKey).map((item) => <option value={item.id} key={item.id}>{organizerDayLabel(detail.draft.event.days, item.periodKey)}</option>)}</select></label>
    </div>
    <div className={styles.mapTabs}>{maps.map((map) => <button type="button" className={selected?.id === map.id ? styles.eventActive : styles.ghost} key={map.id} onClick={() => discarding(() => { void open(map).catch((error) => loadFailed(message(error))); })}>{organizerDayLabel(detail.draft.event.days, map.periodKey)}{detail.draft.venue.assignments.length > 1 ? `・${organizerVenueSpaceLabel(detail.venueCatalog, map.venueSpaceId)}` : ""}</button>)}</div>
    {layout ? <>
      <MapLayoutEditor key={`${periodKey}:${venueSpaceId}`} layout={layout} scope={scope} focusTarget={focusTarget} authoring={authoring} backgroundImageUrl={background || undefined} onChange={(next, nextAuthoring) => { setLayout(next); setAuthoring(nextAuthoring); setEdited(true); setSaveResult(null); }} />
      {/* Nothing to save is a disabled button, the same answer the draft form
          gives. It is not only tidiness: every save moves the candidate on a
          version and writes a revision, so a save with no edits leaves a step
          in the history that records nothing. An empty canvas is the same step
          through the other door -- a first save of a map with no booths also
          moves the candidate on and writes a revision recording nothing, and
          then counts itself as 1 張地圖 (#218). */}
      <div className={styles.mapActions} role="group" aria-label="地圖儲存動作">
        <button type="button" disabled={!editable || savingMap || !layoutHasContent(layout) || (!!selected && !edited)} onClick={() => { void saveMap(); }}>{savingMap ? "儲存中…" : selected ? "儲存地圖變更" : "建立這個活動日與空間的地圖"}</button>
        <button type="button" className={styles.ghost} disabled={savingMap} onClick={() => unsaved ? setConfirmingClose(true) : closeEditor()}>關閉編輯器</button>
        {/* One line, one truth: the result replaces the dirty state instead of
          standing beside a contradiction of it (#220). */}
      <span aria-live="polite" className={saveResult && !saveResult.ok ? styles.error : undefined}>
        {savingMap ? "儲存中，請稍候。" : saveResult ? saveResult.text
          : !layoutHasContent(layout) ? "先在畫布上放入至少一個攤位或設施，才能儲存這張地圖。"
          : selected ? edited ? "尚有未儲存變更" : "目前沒有未儲存的變更" : ""}
      </span>
      </div>
    </> : <div className={styles.placeholder}>
      {/* The next step is a job with a name, not a menu of starting points:
          the reader arrived here because this day and this space have no map
          yet, so that is what the button says. When the booth list it would
          be drawn against is missing, the only useful action is in another
          section, so the button goes there (#221 Phase 5). */}
      {importedRows === 0 ? <>
        <p>先匯入{organizerDayLabel(detail.draft.event.days, periodKey)}的攤位名單，才知道這張地圖要畫哪些攤位。</p>
        <button type="button" onClick={() => onSection("import")}>前往攤位匯入</button>
      </> : <>
        <p>{organizerDayLabel(detail.draft.event.days, periodKey)}・{organizerVenueSpaceLabel(detail.venueCatalog, venueSpaceId)}尚未建立地圖。</p>
        <button type="button" disabled={!editable || !assignment} onClick={startBlank}>建立這張地圖</button>
        <p>也可以上傳配置圖，或從同一個場館空間的其他活動日複製。</p>
      </>}
    </div>}
    {confirmingClose && <div className={styles.dialogBackdrop}>
      <section ref={closeDialog} className={styles.navigationDialog} role="dialog" aria-modal="true" aria-labelledby="unsaved-map-title" aria-describedby="unsaved-map-description" tabIndex={-1}>
        <h3 id="unsaved-map-title">尚有未儲存變更</h3>
        <p id="unsaved-map-description">{layoutHasContent(layout)
          ? "要先儲存地圖，再關閉編輯器嗎？"
          : "這張地圖還沒有任何攤位或設施，不能儲存。關閉就會放棄畫面上的內容。"}</p>
        <div className={styles.dialogActions}>
          {/* The same rule as the panel behind it: a map with nothing on it is
              not saved on the way out either (#218). */}
          <button type="button" disabled={!editable || savingMap || !layoutHasContent(layout)} onClick={() => { void saveMap(true); }}>儲存並關閉</button>
          <button type="button" className={styles.secondary} onClick={closeEditor}>放棄</button>
          <button type="button" className={styles.ghost} onClick={() => setConfirmingClose(false)}>取消</button>
        </div>
      </section>
    </div>}
    {confirm && <MapConfirmDialog confirm={confirm} onCancel={() => setConfirm(null)}
      onConfirm={() => { setConfirm(null); confirm.run(); }} />}
  </section>;
}

/** The sample never leaves the browser either; it is written from event data on the spot. */
