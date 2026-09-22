import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminApp from "./app/admin/admin-app";

const root = document.getElementById("root");
if (!root) throw new Error("Application root element is missing.");
createRoot(root).render(<StrictMode><AdminApp /></StrictMode>);
