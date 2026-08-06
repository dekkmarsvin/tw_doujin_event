"use client";

import { useRef, useState } from "react";
import { publishEventMap } from "./event-map-client";
import EventMapRenderer from "./event-map-renderer";
import { recognizeFF47Map } from "./map-recognition";
import type { MapRecognitionReport, PublishedEventMap } from "./event-map";
import { UiIcon } from "./ui-icons";
import { useModalFocus } from "./use-modal-focus";
import styles from "./map-admin-importer.module.css";

type Props = {
  eventId: string;
  onPublished: (map: PublishedEventMap) => void;
  onClose: () => void;
};

const MAX_FILE_SIZE = 4 * 1024 * 1024;

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

export default function MapAdminImporter({ eventId, onPublished, onClose }: Props) {
  const [sourceName, setSourceName] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [report, setReport] = useState<MapRecognitionReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"recognizing" | "publishing" | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalFocus(true, dialogRef, onClose);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setError("");
    setReport(null);
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
      setReport(recognizeFF47Map({ data: pixels.data, width: pixels.width, height: pixels.height }));
      setSourceName(file.name);
      setImageDataUrl(source);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置圖辨識失敗。" );
    } finally {
      setBusy(null);
    }
  };

  const canPublish = !!report && report.confidence >= .85 && report.diagnostics.rowCount === 23 && report.diagnostics.slotCount === 988 && report.diagnostics.pillarCount === 28 && report.diagnostics.accessPointCount === 5;

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
        <div><small>ADMIN · MAP RECOGNITION</small><h2 id="admin-map-title">管理 FF47 活動地圖</h2></div>
        <button onClick={onClose} aria-label="關閉管理地圖視窗"><UiIcon name="close" /></button>
      </header>

      <div className={styles.intro}><b>匯入一次，發布給所有使用者</b><p>圖片只用於管理辨識與比對。發布後保存的是 A–W 攤位、柱子與出入口的向量資料，一般使用者不需要上傳圖片。</p></div>

      <label className={`${styles.dropzone} ${busy ? styles.busy : ""}`}>
        <input data-testid="map-image-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handleFile(event.target.files?.[0])} disabled={!!busy} />
        <span aria-hidden="true"><UiIcon name="upload" /></span><b>{busy === "recognizing" ? "正在辨識向量地圖…" : sourceName || "選擇 FF47 社團攤位配置圖"}</b><small>JPG、PNG 或 WebP，最大 4MB</small>
      </label>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {report && <>
        <div className={styles.summary}>
          <div><small>辨識信心</small><b className={report.confidence >= .85 ? styles.good : styles.warn}>{Math.round(report.confidence * 100)}%</b></div>
          <div><small>A–W 排</small><b>{report.diagnostics.rowCount}<i>/ 23</i></b></div>
          <div><small>攤位格</small><b>{report.diagnostics.slotCount}<i>/ 988</i></b></div>
          <div><small>柱子</small><b>{report.diagnostics.pillarCount}</b></div>
          <div><small>出入口</small><b>{report.diagnostics.accessPointCount}</b></div>
        </div>

        <div className={styles.comparison}>
          <figure>
            <figcaption>原始配置圖（僅供管理比對）</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element -- admin-only local recognition preview */}
            <img src={imageDataUrl} alt="管理員上傳的 FF47 原始配置圖" />
          </figure>
          <figure><figcaption>可發布的 SVG 地圖</figcaption><div className={styles.vectorPreview}><EventMapRenderer layout={report.layout} slots={{}} onSelect={() => undefined} /></div></figure>
        </div>

        <div className={styles.rows} aria-label="已辨識 A 到 W 排">{report.layout.rows.map((row) => <span key={row.label}>{row.label}<small>{row.orientation === "horizontal" ? "橫" : "直"} · {row.slots.length}</small></span>)}</div>
        {!!report.warnings.length && <div className={styles.warnings}><b>辨識備註</b>{report.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
        <footer className={styles.actions}><button onClick={onClose}>取消</button><button className={styles.publish} disabled={!canPublish || !!busy} onClick={() => void publish()}>{busy === "publishing" ? "正在發布…" : "發布活動地圖"}<UiIcon name="external" /></button></footer>
      </>}
    </section>
  </div>;
}
