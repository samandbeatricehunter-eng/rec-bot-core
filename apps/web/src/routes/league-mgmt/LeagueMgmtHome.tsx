import { Link } from "react-router-dom";

export function LeagueMgmtHome() {
  return (
    <div>
      <h2>League Mgmt</h2>
      <ul>
        <li><Link to="/league-mgmt/schedule">Schedule</Link></li>
        <li><Link to="/league-mgmt/teams">Teams</Link></li>
        <li><Link to="/league-mgmt/box-scores">Box Scores</Link></li>
      </ul>
    </div>
  );
}
