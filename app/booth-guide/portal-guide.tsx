import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EventDefinition } from "../event-catalog";
import type { EventMapLayout } from "../event-map";
import { loadStaticEventMap } from "../static-event-map-client";
import { dayDateLabel, eventDayCalendarDate } from "../event-calendar";
import { useLocale } from "../i18n/locale-context";
import { useModalFocus } from "../use-modal-focus";
import BoothGuideEditor from "./editor";
import { useGuideText } from "./messages";
import type { guidePlacements } from "./placements";

type Choice = ReturnType<typeof guidePlacements>[number];

export default function PortalBoothGuide({ event, choices, name, pictureUrl, onClose }: {
  event: EventDefinition; choices: Choice[]; name: string; pictureUrl?: string; onClose: () => void;
}) {
  const t = useGuideText(), { locale } = useLocale();
  const [selected, setSelected] = useState(choices[0].placement.id);
  const dialog = useRef<HTMLDivElement>(null);
  useModalFocus(true, dialog, onClose);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const choice = choices.find(item => item.placement.id === selected) ?? choices[0];
  const label = (item: Choice) => {
    const date = eventDayCalendarDate(event, item.placement.day);
    return `${date ? dayDateLabel(date, locale) : event.days.find(day => day.id === item.placement.day)!.dateLabel} · ${item.venue.venueSpaceName} · ${item.placement.boothCode}`;
  };
  return createPortal(<div className="booth-guide guide-overlay" ref={dialog} role="dialog" aria-modal="true" aria-label={t("製作攤位導引圖")} tabIndex={-1}>
    <header className="guide-heading"><div><h1>{t("製作攤位導引圖")}</h1><p>{event.name} · {name}</p></div>
      <button type="button" onClick={onClose}>{t("返回社團資料")}</button></header>
    <main>
      <ScopedGuide key={choice.placement.id} event={event} choice={choice} name={name} pictureUrl={pictureUrl} choose={choices.length > 1
        ? <label>{t("日期與攤位")}<select value={selected} onChange={e => setSelected(e.target.value)}>{choices.map(item =>
          <option key={item.placement.id} value={item.placement.id}>{label(item)}</option>)}</select></label>
        : <p className="hint">{label(choice)}</p>} />
    </main>
  </div>, document.body);
}

function ScopedGuide({ event, choice, name, pictureUrl, choose }: {
  event: EventDefinition; choice: Choice; name: string; pictureUrl?: string; choose: React.ReactNode;
}) {
  const t = useGuideText();
  const [layout, setLayout] = useState<EventMapLayout | null>(null), [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { placement, venue } = choice;
  useEffect(() => {
    let active = true;
    void loadStaticEventMap(event.id, { periodKey: String(placement.day), venueSpaceId: venue.venueSpaceId })
      .then(map => { if (active) setLayout(map.layout); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [event.id, placement.day, venue.venueSpaceId, attempt]);
  if (failed) return <div>{choose}<div className="load-error" role="alert">{t("活動地圖無法讀取，請重試。")}<button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>{t("重新讀取")}</button></div></div>;
  if (!layout) return <div>{choose}<p className="loading" role="status">{t("正在準備活動地圖…")}</p></div>;
  if (!layout.rows.some(row => row.slots.some(slot => slot.code === placement.boothCode))) return <div>{choose}<p role="status">{t("這個攤位尚未有地圖位置。")}</p></div>;
  return <BoothGuideEditor event={event} day={placement.day} venueId={venue.venueSpaceId} layout={layout} placement={placement} name={name} pictureUrl={pictureUrl}
    pictureReadUrl={pictureUrl ? `/api/circle/${encodeURIComponent(placement.circleId)}/thumbnail?event=${encodeURIComponent(event.id)}` : undefined} choose={choose} />;
}
