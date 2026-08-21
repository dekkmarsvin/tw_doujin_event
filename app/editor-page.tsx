"use client";

import { useEffect, useState } from "react";
import { loadPublishedEventMap } from "./event-map-client";
import type { PublishedEventMap } from "./event-map";
import { ACTIVE_EVENT_ID } from "./event-catalog";
import MapAdminImporter from "./map-admin-importer";

export default function EditorPage() {
  const [publishedMap, setPublishedMap] = useState<PublishedEventMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void loadPublishedEventMap(ACTIVE_EVENT_ID)
      .then((map) => { if (!cancelled) setPublishedMap(map); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "讀取活動地圖失敗。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <main><p>正在讀取本機編輯資料…</p></main>;
  if (!open) return <main><button type="button" onClick={() => setOpen(true)}>重新開啟地圖編輯器</button></main>;

  return <main>
    {error && <p role="alert">{error}</p>}
    <MapAdminImporter
      eventId={ACTIVE_EVENT_ID}
      initialMap={publishedMap}
      onPublished={(map) => { setPublishedMap(map); setError(""); }}
      onClose={() => setOpen(false)}
    />
  </main>;
}
