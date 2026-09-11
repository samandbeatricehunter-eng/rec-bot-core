import { useNavigate } from "react-router-dom";

export type StandingsNavId = "division" | "power" | "sos" | "bracket";

const STANDINGS_NAV: Array<{ id: StandingsNavId; top: string; bottom: string }> = [
  { id: "division", top: "Division", bottom: "Standings" },
  { id: "power", top: "Power", bottom: "Rankings" },
  { id: "sos", top: "Strength of", bottom: "Schedule" },
  { id: "bracket", top: "Playoff", bottom: "Bracket" },
];

export function StandingsMiniNav({
  active,
  leagueId,
  bracketAvailable = true,
}: {
  active: StandingsNavId;
  leagueId: string;
  bracketAvailable?: boolean;
}) {
  const navigate = useNavigate();

  return (
    <nav className="hub-standings-mini-nav" aria-label="Standings views">
      {STANDINGS_NAV.map((item) => {
        const isBracket = item.id === "bracket";
        const selected = item.id === active;
        const disabled = isBracket && !bracketAvailable && !selected;
        return (
          <button
            key={item.id}
            type="button"
            className={selected ? "is-selected" : undefined}
            disabled={disabled}
            title={isBracket && disabled ? "Playoff bracket unlocks in Week 12" : undefined}
            aria-pressed={selected}
            onClick={() => {
              if (selected) return;
              if (isBracket) {
                navigate(`/l/${leagueId}/playoff-bracket`);
                return;
              }
              const query = item.id === "division" ? "" : `?view=${item.id}`;
              navigate(`/l/${leagueId}/standings${query}`);
            }}
          >
            <span>{item.top}</span>
            <strong>{item.bottom}</strong>
          </button>
        );
      })}
    </nav>
  );
}
