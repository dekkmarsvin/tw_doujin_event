"use client";

import { useRef, useState } from "react";
import { publishEventMap } from "./event-map-client";
import EventMapRenderer from "./event-map-renderer";
import MapLayoutEditor from "./map-layout-editor";
import { LANDMARK_RECOGNITION_WARNING, recognizeFF47Map } from "./map-recognition";
import { scaleMapLandmarks, validateFF47EventMapLayout, type EventMapLayout, type MapRecognitionReport, type PublishedEventMap } from "./event-map";
import { UiIcon } from "./ui-icons";
import { useModalFocus } from "./use-modal-focus";
import styles from "./map-admin-importer.module.css";

type Props = {
  eventId: string;
  initialMap?: PublishedEventMap | null;
  onPublished: (map: PublishedEventMap) => void;
  onClose: () => void;
};

const MAX_FILE_SIZE = 4 * 1024 * 1024;

function diagnostics(layout: EventMapLayout) {
  return {
    rowCount: layout.rows.length,
    slotCount: layout.rows.reduce((total, row) => total + row.slots.length, 0),
    pillarCount: layout.pillars.length,
    accessPointCount: layout.accessPoints.length,
  };
}

function reportFromPublished(map?: PublishedEventMap | null): MapRecognitionReport | null {
  if (!map) return null;
  return { layout: map.layout, confidence: map.confidence, warnings: map.layout.landmarks.length ? [] : [LANDMARK_RECOGNITION_WARNING], diagnostics: diagnostics(map.layout) };
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("無法讀取圖片檔案。"));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("圖片格式無法解析。"));
    image.src = source;
  });
}

export default function MapAdminImporter({ eventId, initialMap, onPublished, onClose }: Props) {
  const initialReport = reportFromPublished(initialMap);
  const [sourceName, setSourceName] = useState(initialMap?.sourceName ?? "");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [report, setReport] = useState<MapRecognitionReport | null>(initialReport);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"recognizing" | "publishing" | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const [baselineReport, setBaselineReport] = useState<MapRecognitionReport | null>(initialReport);
  useModalFocus(true, dialogRef, onClose);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("請選擇 JPG、PNG 或 WebP 圖片。" );
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("圖片超過 4MB；請使用原始配置圖或適度壓縮後再試。" );
      return;
    }
    setBusy("recognizing");
    try {
      const source = await readFile(file);
      const image = await loadImage(source);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("瀏覽器無法建立圖片分析畫布。" );
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const recognized = recognizeFF47Map({ data: pixels.data, width: pixels.width, height: pixels.height });
      const previousLayout = report?.layout;
      if (previousLayout?.landmarks.length) {
        recognized.layout.landmarks = scaleMapLandmarks(previousLayout.landmarks, previousLayout, recognized.layout);
        recognized.warnings.push(`已依新圖片尺寸保留 ${previousLayout.landmarks.length} 個手動區域；請在發布前確認位置。`);
      }
      setReport(recognized);
      setBaselineReport(recognized);
      setSourceName(file.name);
      setImageDataUrl(source);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置圖辨識失敗。" );
    } finally {
      setBusy(null);
    }
  };

  const currentDiagnostics = report ? diagnostics(report.layout) : null;
  const layoutValidation = report ? validateFF47EventMapLayout(report.layout) : null;
  const canPublish = !!report && report.confidence >= .85 && !!layoutValidation?.ok;
  const visibleWarnings = [...new Set([...(report?.warnings ?? []), ...(layoutValidation && !layoutValidation.ok ? layoutValidation.errors : [])])];

  const publish = async () => {
    if (!report || !canPublish) return;
    setBusy("publishing");
    setError("");
    try {
      const published = await publishEventMap(eventId, { sourceName, confidence: report.confidence, layout: report.layout });
      onPublished(published);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "發布活動地圖失敗。" );
    } finally {
      setBusy(null);
    }
  };

  return <div className={styles.backdrop} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="admin-map-title" tabIndex={-1}>
      <header className={styles.header}>
        <div><small>ADMIN · MAP EDITOR</small><h2 id="admin-map-title">管理 FF47 活動地圖</h2></div>
        <button onClick={onClose} aria-label="關閉管理地圖視窗"><UiIcon name="close" /></button>
      </header>

      <div className={styles.intro}><b>辨識、微調，再發布給所有使用者</b><p>可直接編輯目前 revision，或重新匯入配置圖。圖片只用於管理辨識與比對；發布保存的是一般攤位、柱子、出入口、企業攤與舞台等向量資料。</p></div>

      <label className={`${styles.dropzone} ${busy ? styles.busy : ""}`}>
        <input data-testid="map-image-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handleFile(event.target.files?.[0])} disabled={!!busy} />
        <span aria-hidden="true"><UiIcon name="upload" /></span><b>{busy === "recognizing" ? "正在辨識向量地圖…" : sourceName || "選擇 FF47 社團攤位配置圖"}</b><small>JPG、PNG 或 WebP，最大 4MB</small>
      </label>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {report && <>
        <div className={styles.summary}>
          <div><small>一般結構辨識信心</small><b className={report.confidence >= .85 ? styles.good : styles.warn}>{Math.round(report.confidence * 100)}%</b></div>
          <div><small>A–W 排</small><b>{currentDiagnostics?.rowCount}<i>/ 23</i></b></div>
          <div><small>攤位格</small><b>{currentDiagnostics?.slotCount}<i>/ 988</i></b></div>
          <div><small>柱子</small><b>{currentDiagnostics?.pillarCount}</b></div>
          <div><small>出入口</small><b>{currentDiagnostics?.accessPointCount}</b></div>
        </div>

        <div className={`${styles.comparison} ${!imageDataUrl ? styles.vectorOnly : ""}`}>
          {imageDataUrl && <figure>
            <figcaption>原始配置圖（僅供管理比對）</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element -- admin-only local recognition preview */}
            <img src={imageDataUrl} alt="管理員上傳的 FF47 原始配置圖" />
          </figure>}
          <figure><figcaption>可發布的 SVG 地圖</figcaption><div className={styles.vectorPreview}><EventMapRenderer layout={report.layout} slots={{}} onSelect={() => undefined} /></div></figure>
        </div>

        <MapLayoutEditor layout={report.layout} backgroundImageUrl={imageDataUrl} onChange={(layout) => setReport((current) => current ? { ...current, layout, diagnostics: diagnostics(layout) } : current)} />
        <div className={styles.rows} aria-label="已辨識 A 到 W 排">{report.layout.rows.map((row) => <span key={row.label}>{row.label}<small>{row.orientation === "horizontal" ? "橫" : "直"} · {row.slots.length}</small></span>)}</div>
        {!!visibleWarnings.length && <div className={styles.warnings}><b>發布前檢查</b>{visibleWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
        <footer className={styles.actions}><button onClick={onClose}>取消</button><button disabled={!baselineReport || !!busy} onClick={() => baselineReport && setReport(baselineReport)}>還原本次編輯</button><button className={styles.publish} disabled={!canPublish || !!busy} onClick={() => void publish()}>{busy === "publishing" ? "正在發布…" : "發布活動地圖"}<UiIcon name="external" /></button></footer>
      </>}
    </section>
  </div>;
}
