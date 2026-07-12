import { Link } from "react-router-dom";

// Mirrors apps/bot/src/ui/menu.ts's top-level nav — only League Mgmt has real screens
// behind it so far; everything else the bot already covers stays in Discord for now.
export function MainMenu() {
  return (
    <div>
      <h1>REC Bot</h1>
      <Link to="/league-mgmt">League Mgmt →</Link>
    </div>
  );
}
