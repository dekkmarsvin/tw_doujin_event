import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OrganizerApp from "./app/organizer/organizer-app";

const root = document.getElementById("root");
if (!root) throw new Error("Application root element is missing.");

createRoot(root).render(
  <StrictMode>
    <OrganizerApp />
  </StrictMode>,
);
