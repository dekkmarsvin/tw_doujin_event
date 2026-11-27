import { useLocale } from "./i18n/locale-context";
import { localizedHref } from "./i18n/locale";

export function OwnedCircleLink({ eventId, circleId }: { eventId: string; circleId: string }) {
  const { locale } = useLocale();
  return <a href={localizedHref(`/circle?${new URLSearchParams({ event: eventId, circle: circleId })}`, locale)}>
    {locale === "en" ? "Your circle · Edit this page" : locale === "ja" ? "あなたのサークル · このページを編集" : "這是你的社團 · 編輯這頁"}
  </a>;
}
