import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CirclePortalApp from "./app/circle-portal/portal-app";

const root = document.getElementById("root");
if (!root) throw new Error("Application root element is missing.");

createRoot(root).render(
  <StrictMode>
    <CirclePortalApp />
  </StrictMode>,
);
