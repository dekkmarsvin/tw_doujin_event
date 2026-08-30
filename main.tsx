import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import EventEntry from "./app/event-entry";
import "./app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root element is missing.");

createRoot(root).render(
  <StrictMode>
    <EventEntry />
  </StrictMode>,
);

// Offline shell for venue use. Only the built Pages artifact ships a worker, so
// `npm run dev:pages` keeps serving fresh modules without a cache in front.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is an enhancement; the app still works without it.
    });
  });
}
