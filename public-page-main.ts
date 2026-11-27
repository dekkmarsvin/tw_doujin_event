import { startPublicPageLocale } from "./app/public-page-locale";
import { subscribeSignedInChange, wasSignedIn } from "./app/session-hint";

startPublicPageLocale();

const slot = document.getElementById("public-workspace-menu");
if (slot?.dataset.circleHref) {
  const circleHref = slot.dataset.circleHref;
  const mountIfSignedIn = () => {
    if (!wasSignedIn()) return;
    unsubscribe();
    void import("./app/mount-event-workspace-menu").then(({ mountEventWorkspaceMenu }) => mountEventWorkspaceMenu(slot, circleHref));
  };
  const unsubscribe = subscribeSignedInChange(mountIfSignedIn);
  mountIfSignedIn();
}
