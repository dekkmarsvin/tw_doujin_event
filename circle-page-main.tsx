import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CirclePageApp from "./app/circle-page/circle-page-app";
import { CIRCLE_PAGE_DATA_ID, CIRCLE_PAGE_ROOT_ID, readCirclePageData } from "./app/circle-page-data";

// A page this script cannot read stays the complete static page it already is.
const root = document.getElementById(CIRCLE_PAGE_ROOT_ID);
const data = readCirclePageData(document.getElementById(CIRCLE_PAGE_DATA_ID)?.textContent);
if (root && data) {
  createRoot(root).render(
    <StrictMode>
      <CirclePageApp data={data} />
    </StrictMode>,
  );
}
