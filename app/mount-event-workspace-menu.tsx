import { createRoot } from "react-dom/client";
import { LocaleProvider } from "./i18n/locale-context";
import { PublicWorkspaceMenu } from "./public-workspace-menu";
import { useReaderAccount } from "./use-reader-account";

function EventWorkspaceMenu({ circleHref }: { circleHref: string }) {
  const account = useReaderAccount("", true);
  return account && <PublicWorkspaceMenu session={account.session} circleHref={circleHref} />;
}

export function mountEventWorkspaceMenu(slot: HTMLElement, circleHref: string) {
  createRoot(slot).render(<LocaleProvider><EventWorkspaceMenu circleHref={circleHref} /></LocaleProvider>);
}
