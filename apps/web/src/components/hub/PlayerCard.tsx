import { useMemo, useState, type MouseEvent } from "react";
import { MADDEN_ATTRIBUTE_DEFINITIONS, normalizeMaddenDevTrait } from "@rec/shared";
import { ATTRIBUTE_KEY_TO_CODE, attributeLabel } from "../../lib/attribute-columns.js";

export type PlayerCardAbility = { name: string; description?: string };

export type PlayerCardData = {
  fullName: string;
  position: string;
  overallRating: number | null;
  /** Stored Cloudflare / CDN headshot — never a generated placeholder portrait. */
  photoUrl: string | null;
  attributes: Record<string, number | null>;
  heightInches?: number | null;
  weightLbs?: number | null;
  college?: string | null;
  jerseyNumber?: number | null;
  archetype?: string | null;
  /** Madden: normal | star | superstar | xfactor. CFB: normal | impact | star | elite. */
  devTrait?: string | null;
  abilities?: PlayerCardAbility[] | null;
  /** legend | immortal | custom — overrides frame when set (beyond baseline dev trait). */
  cardKind?: "baseline" | "legend" | "immortal" | "custom" | null;
};

type CardTier = "normal" | "star" | "superstar" | "xfactor" | "legend" | "immortal" | "custom";

const CODE_TO_KEY = Object.fromEntries(
  Object.entries(ATTRIBUTE_KEY_TO_CODE).map(([key, code]) => [code, key]),
) as Record<string, string>;

/** Front-of-card spotlight attrs by coarse position (snake_case keys). */
const FRONT_ATTRS_BY_POS: Record<string, string[]> = {
  QB: ["throw_power", "throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep", "awareness", "throw_on_the_run", "throw_under_pressure", "play_action"],
  HB: ["speed", "acceleration", "agility", "change_of_direction", "break_tackle", "carrying", "bc_vision", "juke_move"],
  RB: ["speed", "acceleration", "agility", "change_of_direction", "break_tackle", "carrying", "bc_vision", "juke_move"],
  FB: ["run_block", "impact_blocking", "lead_block", "strength", "carrying", "trucking", "run_block_power", "awareness"],
  WR: ["speed", "acceleration", "catching", "spectacular_catch", "route_running_short", "route_running_medium", "route_running_deep", "release"],
  TE: ["catching", "run_block", "pass_block", "route_running_short", "route_running_medium", "strength", "catch_in_traffic", "speed"],
  LT: ["pass_block", "run_block", "pass_block_power", "run_block_power", "strength", "pass_block_finesse", "impact_blocking", "awareness"],
  LG: ["pass_block", "run_block", "pass_block_power", "run_block_power", "strength", "pass_block_finesse", "impact_blocking", "awareness"],
  C: ["pass_block", "run_block", "pass_block_power", "run_block_power", "strength", "pass_block_finesse", "impact_blocking", "awareness"],
  RG: ["pass_block", "run_block", "pass_block_power", "run_block_power", "strength", "pass_block_finesse", "impact_blocking", "awareness"],
  RT: ["pass_block", "run_block", "pass_block_power", "run_block_power", "strength", "pass_block_finesse", "impact_blocking", "awareness"],
  LEDGE: ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "strength", "acceleration", "play_recognition"],
  REDGE: ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "strength", "acceleration", "play_recognition"],
  LEDG: ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "strength", "acceleration", "play_recognition"],
  REDG: ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "strength", "acceleration", "play_recognition"],
  LE: ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "strength", "acceleration", "play_recognition"],
  RE: ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "strength", "acceleration", "play_recognition"],
  DT: ["power_moves", "finesse_moves", "block_shedding", "pursuit", "tackle", "strength", "acceleration", "play_recognition"],
  WILL: ["tackle", "pursuit", "play_recognition", "zone_coverage", "man_coverage", "hit_power", "block_shedding", "speed"],
  MIKE: ["tackle", "pursuit", "play_recognition", "zone_coverage", "man_coverage", "hit_power", "block_shedding", "speed"],
  SAM: ["tackle", "pursuit", "play_recognition", "zone_coverage", "man_coverage", "hit_power", "block_shedding", "speed"],
  LOLB: ["tackle", "pursuit", "play_recognition", "zone_coverage", "man_coverage", "hit_power", "block_shedding", "speed"],
  MLB: ["tackle", "pursuit", "play_recognition", "zone_coverage", "man_coverage", "hit_power", "block_shedding", "speed"],
  ROLB: ["tackle", "pursuit", "play_recognition", "zone_coverage", "man_coverage", "hit_power", "block_shedding", "speed"],
  CB: ["speed", "acceleration", "agility", "change_of_direction", "zone_coverage", "man_coverage", "play_recognition", "press"],
  FS: ["speed", "acceleration", "zone_coverage", "man_coverage", "play_recognition", "tackle", "pursuit", "agility"],
  SS: ["speed", "acceleration", "zone_coverage", "man_coverage", "play_recognition", "tackle", "pursuit", "hit_power"],
  K: ["kick_power", "kick_accuracy", "awareness", "stamina", "speed", "acceleration", "agility", "injury"],
  P: ["kick_power", "kick_accuracy", "awareness", "stamina", "speed", "acceleration", "agility", "injury"],
};

const DEFAULT_FRONT_ATTRS = ["speed", "acceleration", "agility", "strength", "awareness", "stamina", "injury", "toughness"];

const BACK_GROUPS: Array<{ label: string; codes: string[] }> = [
  { label: "Physical", codes: ["SPD", "ACC", "STR", "AGI", "AWR", "JMP", "INJ", "STA", "TOU"] },
  { label: "Passing", codes: ["THP", "TUP", "SAC", "MAC", "DAC", "RUN", "PAC"] },
  { label: "Receiving", codes: ["CTH", "SPC", "CIT", "SRR", "MRR", "DRR", "RLS"] },
  { label: "Ball Carrier", codes: ["CAR", "BTK", "TRK", "COD", "BCV", "SFA", "SPM", "JKM", "BSK"] },
  { label: "Defense", codes: ["TAK", "PMV", "FMV", "BSH", "PUR", "PRC", "MCV", "ZCV", "POW", "PRS"] },
  { label: "Blocking", codes: ["RBK", "PBK", "IBL", "RBP", "RBF", "PBP", "PBF", "LBK"] },
  { label: "Kicking", codes: ["KPW", "KAC", "RET"] },
];

function resolveTier(player: PlayerCardData): CardTier {
  if (player.cardKind === "legend") return "legend";
  if (player.cardKind === "immortal") return "immortal";
  if (player.cardKind === "custom") return "custom";
  return resolveDevTraitTier(player.devTrait);
}

function traitBadgeSrc(tier: CardTier): string | null {
  if (tier === "star") return "/assets/player-cards/dev-trait-star.png";
  if (tier === "superstar") return "/assets/player-cards/dev-trait-superstar.png";
  if (tier === "xfactor") return "/assets/player-cards/dev-trait-xfactor.png";
  return null;
}

function resolveDevTraitTier(devTrait: string | null | undefined): CardTier {
  return normalizeMaddenDevTrait(devTrait) ?? "normal";
}

function formatHeight(inches: number | null | undefined): string | null {
  if (inches == null || !Number.isFinite(inches)) return null;
  const ft = Math.floor(inches / 12);
  const rem = Math.round(inches % 12);
  return `${ft}'${rem}"`;
}

function tierLabel(tier: CardTier): string {
  switch (tier) {
    case "star": return "STAR";
    case "superstar": return "SUPERSTAR";
    case "xfactor": return "X-FACTOR";
    case "legend": return "LEGEND";
    case "immortal": return "IMMORTAL";
    case "custom": return "CUSTOM";
    default: return "NORMAL";
  }
}

function attrValue(attributes: Record<string, number | null>, keyOrCode: string): number | null {
  if (keyOrCode in attributes) return attributes[keyOrCode];
  const key = CODE_TO_KEY[keyOrCode.toUpperCase()];
  if (key && key in attributes) return attributes[key];
  const def = MADDEN_ATTRIBUTE_DEFINITIONS.find((d) => d.code === keyOrCode.toUpperCase() || d.name.toLowerCase() === keyOrCode.toLowerCase());
  if (def) {
    const snake = CODE_TO_KEY[def.code];
    if (snake && snake in attributes) return attributes[snake];
    if (def.name in attributes) return attributes[def.name];
  }
  return null;
}

/**
 * Flip-capable MUT-style player card. Frame/tier is CSS; portrait is always the player's
 * stored `photoUrl` (Cloudflare). Star / Superstar / X-Factor show the Madden trait badge
 * under the OVR hex on the front.
 */
export function PlayerCard({
  player,
  className = "",
  initiallyFlipped = false,
}: {
  player: PlayerCardData;
  className?: string;
  initiallyFlipped?: boolean;
}) {
  const [flipped, setFlipped] = useState(initiallyFlipped);
  const tier = resolveTier(player);
  // Frame kind and development trait are independent: legends/custom players retain their
  // special frame while still displaying the Madden/CFB development badge on the front.
  const devTraitTier = resolveDevTraitTier(player.devTrait);
  const badge = traitBadgeSrc(devTraitTier);

  const frontAttrs = useMemo(() => {
    const keys = FRONT_ATTRS_BY_POS[player.position.toUpperCase()] ?? DEFAULT_FRONT_ATTRS;
    return keys.slice(0, 8).map((key) => ({
      key,
      label: attributeLabel(key),
      value: attrValue(player.attributes, key),
    }));
  }, [player.attributes, player.position]);

  const bio = [
    formatHeight(player.heightInches),
    player.weightLbs != null ? `${player.weightLbs} lbs` : null,
    player.college,
    player.jerseyNumber != null ? `#${player.jerseyNumber}` : null,
  ].filter(Boolean).join(" · ");

  function flip(event?: MouseEvent) {
    event?.stopPropagation();
    setFlipped((v) => !v);
  }

  return (
    <div className={`rec-player-card-stage rec-player-card-stage--${tier} ${className}`.trim()}>
      <div className={`rec-player-card rec-player-card--${tier}${flipped ? " is-flipped" : ""}`}>
        <div className="rec-player-card-inner">
          <button
            type="button"
            className="rec-player-card-face rec-player-card-front"
            onClick={flip}
            aria-label={`${player.fullName} card front. Activate to flip.`}
          >
            <div className="rec-player-card-frame" aria-hidden="true" />
            <div className="rec-player-card-chrome" aria-hidden="true" />

            <div className="rec-player-card-top">
              <div className="rec-player-card-ovr-stack">
                <div className="rec-player-card-ovr">
                  <strong>{player.overallRating ?? "—"}</strong>
                  <span>OVR</span>
                </div>
                {badge ? (
                  <img className="rec-player-card-trait-badge" src={badge} alt={tierLabel(devTraitTier)} title={tierLabel(devTraitTier)} />
                ) : null}
              </div>
              <div className="rec-player-card-pos">{player.position || "—"}</div>
            </div>

            <div className="rec-player-card-photo">
              {player.photoUrl ? (
                <img src={player.photoUrl} alt="" loading="lazy" decoding="async" />
              ) : (
                <img
                  className="rec-player-card-photo-silhouette"
                  src="/assets/player-cards/player-silhouette.svg"
                  alt=""
                  aria-hidden="true"
                />
              )}
            </div>

            <div className="rec-player-card-nameplate">
              <strong>{player.fullName}</strong>
              {player.archetype ? <span>{player.archetype}</span> : null}
            </div>

            <div className="rec-player-card-stats">
              {frontAttrs.map((row) => (
                <div key={row.key} className="rec-player-card-stat">
                  <span>{row.label}</span>
                  <strong>{row.value ?? "—"}</strong>
                </div>
              ))}
            </div>

            <div className="rec-player-card-footer">
              <span>{bio || tierLabel(tier)}</span>
              <span className="rec-player-card-brand">REC</span>
            </div>
          </button>

          <div className="rec-player-card-face rec-player-card-back" aria-hidden={!flipped}>
            <div className="rec-player-card-frame" aria-hidden="true" />
            <div className="rec-player-card-chrome" aria-hidden="true" />

            <header className="rec-player-card-back-head">
              <strong>{player.fullName}</strong>
              <span>{player.overallRating ?? "—"} OVR · {player.position || "—"} · {tierLabel(tier)}</span>
            </header>

            <div
              className="rec-player-card-back-scroll"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onWheel={(event) => {
                event.stopPropagation();
              }}
              onTouchMove={(event) => event.stopPropagation()}
            >
              <section className="rec-player-card-back-section">
                <h4>Abilities</h4>
                {player.abilities && player.abilities.length > 0 ? (
                  <ul className="rec-player-card-abilities">
                    {player.abilities.map((ability, index) => (
                      <li key={`${ability.name}-${index}`}>
                        <strong>{ability.name}</strong>
                        {ability.description ? <p>{ability.description}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rec-player-card-empty">No special abilities</p>
                )}
              </section>

              {BACK_GROUPS.map((group) => (
                <section key={group.label} className="rec-player-card-back-section">
                  <h4>{group.label}</h4>
                  <div className="rec-player-card-back-grid">
                    {group.codes.map((code) => (
                      <div key={code} className="rec-player-card-back-cell">
                        <span>{code}</span>
                        <strong>{attrValue(player.attributes, code) ?? "—"}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <button type="button" className="rec-player-card-footer rec-player-card-flip-btn" onClick={flip}>
              <span>Tap to flip</span>
              <span className="rec-player-card-brand">REC</span>
            </button>
          </div>
        </div>
      </div>
      <p className="rec-player-card-hint">{flipped ? "Scroll attributes · tap footer to flip" : "Tap card to flip"}</p>
    </div>
  );
}

/** Map a roster/API player row into PlayerCard props. */
export function toPlayerCardData(player: {
  fullName: string;
  position: string;
  overallRating: number | null;
  photoUrl: string | null;
  attributes: Record<string, number | null>;
  heightInches?: number | null;
  weightLbs?: number | null;
  college?: string | null;
  jerseyNumber?: number | null;
  archetype?: string | null;
  devTrait?: string | null;
  abilities?: PlayerCardAbility[] | null;
  playerSource?: string | null;
}): PlayerCardData {
  const source = player.playerSource ?? null;
  return {
    fullName: player.fullName,
    position: player.position,
    overallRating: player.overallRating,
    photoUrl: player.photoUrl,
    attributes: player.attributes,
    heightInches: player.heightInches,
    weightLbs: player.weightLbs,
    college: player.college,
    jerseyNumber: player.jerseyNumber,
    archetype: player.archetype,
    devTrait: player.devTrait,
    abilities: player.abilities,
    cardKind: source === "custom" || source === "custom_player"
      ? "custom"
      : source === "legend" || source === "immortal"
        ? (source as "legend" | "immortal")
        : "baseline",
  };
}
