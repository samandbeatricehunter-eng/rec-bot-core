import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/themes/cfb27.css";
import "./styles/themes/madden27.css";
import "./styles/reset.css";
import "./styles/typography.css";
import "./styles/shell.css";
import "./styles/surfaces.css";
import "./styles/buttons.css";
import "./styles/icons.css";
import "./styles/football-components.css";
import "./styles/hub.css";
import "./styles/league-management.css";
import "./styles/responsive.css";
import App from "./App.js";

// Universal Platinum chrome (no per-game flash).
document.documentElement.setAttribute("data-site-theme", "app");
document.documentElement.removeAttribute("data-game-theme");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
