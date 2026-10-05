import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CirclePageApp from "./app/circle-page/circle-page-app";
import { LocaleProvider } from "./app/i18n/locale-context";
import { startPublicPageLocale } from "./app/public-page-locale";
import { CIRCLE_PAGE_DATA_ID, CIRCLE_PAGE_ROOT_ID, readCirclePageData } from "./app/circle-page-data";

// The static page follows the reader's language first; the island then joins it.
startPublicPageLocale();

// A page this script cannot read stays the complete static page it already is.
const root = document.getElementById(CIRCLE_PAGE_ROOT_ID);
const data = readCirclePageData(document.getElementById(CIRCLE_PAGE_DATA_ID)?.textContent);
if (root && data) {
  createRoot(root).render(
    <StrictMode>
      <LocaleProvider>
        <CirclePageApp data={data} />
      </LocaleProvider>
    </StrictMode>,
  );
}
