import { Link, useParams } from "react-router-dom";

export function StandardProgression({ kind }: { kind: "player" | "owner" }) {
  const { leagueId = "" } = useParams();
  const title = kind === "player" ? "Player Progression" : "Owner Progression";
  return <main className="site-page" style={{ maxWidth: 800, margin: "3rem auto", padding: "1.5rem" }}>
    <Link to={`/l/${leagueId}/buzz`}>← League home</Link>
    <h1>{title}</h1>
    <p>{kind === "player" ? "The player progression system is still being built. Your unspent Player XP is shown on league home." : "The owner progression tree is still being built. Your Team XP is shown on league home."}</p>
  </main>;
}
