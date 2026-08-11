import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import EventMapApp from "./app/event-map-app";
import "./app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root element is missing.");

createRoot(root).render(
  <StrictMode>
    <EventMapApp />
  </StrictMode>,
);
