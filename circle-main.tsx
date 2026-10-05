import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CirclePortalApp from "./app/circle-portal/portal-app";
import { LocaleProvider } from "./app/i18n/locale-context";

const root = document.getElementById("root");
if (!root) throw new Error("Application root element is missing.");

createRoot(root).render(
  <StrictMode>
    <LocaleProvider><CirclePortalApp /></LocaleProvider>
  </StrictMode>,
);
