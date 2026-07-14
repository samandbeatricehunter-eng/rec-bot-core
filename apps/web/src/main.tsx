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

// Default to the only currently-active league's game type so there's no flash of unstyled
// theme before AppShell's league-header fetch resolves and sets the real value.
document.documentElement.setAttribute("data-game-theme", "cfb_27");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
