import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/site.css";
import App from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registered purely so Chrome/Android treat the site as installable (Set Up Mobile App on
// the Account page) — see public/sw.js for what it does (nothing, yet).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
