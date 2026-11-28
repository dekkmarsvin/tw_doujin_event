import { subscribeSignedInChange, wasSignedIn } from "./session-hint";
import type { Locale } from "./i18n/locale";

export function startPublicAccount(locale?: Locale) {
  const slot = document.getElementById("public-workspace-menu");
  if (slot?.dataset.circleHref) {
    const circleHref = slot.dataset.circleHref;
    const mountIfSignedIn = () => {
      if (!wasSignedIn()) return;
      unsubscribe();
      void import("./mount-event-workspace-menu").then(({ mountEventWorkspaceMenu }) => mountEventWorkspaceMenu(slot, circleHref, locale));
    };
    const unsubscribe = subscribeSignedInChange(mountIfSignedIn);
    mountIfSignedIn();
  }
}
