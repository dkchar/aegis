import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { App } from "./App.js";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Olympus mount point '#app' was not found.");
}

createRoot(app).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
