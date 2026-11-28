import type { Locale } from "./i18n/locale";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "./i18n/locale-context";
import { PublicWorkspaceMenu } from "./public-workspace-menu";
import { useReaderAccount } from "./use-reader-account";

function EventWorkspaceMenu({ circleHref, locale }: { circleHref: string; locale?: Locale }) {
  const account = useReaderAccount("", true);
  return account && <PublicWorkspaceMenu fixedLocale={locale} session={account.session} circleHref={circleHref} />;
}

export function mountEventWorkspaceMenu(slot: HTMLElement, circleHref: string, locale?: Locale) {
  createRoot(slot).render(<LocaleProvider><EventWorkspaceMenu locale={locale} circleHref={circleHref} /></LocaleProvider>);
}
