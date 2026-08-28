import { EmbedBuilder } from "discord.js";
import { buildNavigationRow } from "./navigation.js";
import { LEAGUE_SETUP_CUSTOM_IDS, type LeagueSetupDraft } from "./league-setup-types.js";
import { baseEmbed, option, selectRow } from "./league-setup-shared.js";

export function buildGameSelectWindow(draft: LeagueSetupDraft, notice?: string) {
  const embed = new EmbedBuilder()
    .setTitle("League Setup: Game")
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Which game is this league for? This determines the setup options and features available.",
      "",
      "• **Madden NFL 26** / **Madden NFL 27** — full franchise setup (Madden 27 uses the Madden 26 options for now).",
      "• **College Football 27** — full dynasty setup with recruiting, transfer portal, and conference options."
    ].join("\n"));
  if (notice) embed.addFields({ name: "Heads up", value: notice });

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.game, "Select the game", [
        option("Madden NFL 26", "madden_26"),
        option("Madden NFL 27", "madden_27", "Uses the Madden 26 setup for now."),
        option("College Football 27", "cfb_27", "Dynasty setup with recruiting & transfer portal.")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildImmortalityPositionWindow(draft: LeagueSetupDraft, side: "offense" | "defense") {
  const isOffense = side === "offense";
  const embed = baseEmbed(
    isOffense ? "Rise to Immortality: Offensive Position" : "Rise to Immortality: Defensive Position",
    draft,
  ).setDescription([
    `League: **${draft.name}**`,
    "",
    isOffense
      ? "Every user creates one offensive cornerstone at the **same** position. Pick the league-wide offensive slot."
      : "Every user creates one defensive cornerstone at the **same** position. Pick the league-wide defensive slot.",
    "",
    "This cannot change after the league is created. Nobody creates the other positions on that side.",
  ].join("\n"));

  return {
    embeds: [embed],
    components: [
      selectRow(
        isOffense ? LEAGUE_SETUP_CUSTOM_IDS.immortalityOffense : LEAGUE_SETUP_CUSTOM_IDS.immortalityDefense,
        isOffense ? "Select the offensive position" : "Select the defensive position",
        isOffense
          ? [
              option("Quarterback", "QB"),
              option("Halfback", "HB"),
              option("Wide Receiver", "WR"),
              option("Tight End", "TE"),
            ]
          : [
              option("Cornerback", "CB"),
              option("Free Safety", "FS"),
              option("Strong Safety", "SS"),
              option("MIKE Linebacker", "MIKE"),
            ],
      ),
      buildNavigationRow(),
    ],
  };
}

export function buildRiseLockedEconomyWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("Rise to Immortality: Economy", draft).setDescription([
    `League: **${draft.name}**`,
    "",
    "Store purchases are **off** in this mode. Player XP upgrades ratings; Team XP unlocks later.",
    "Coins are **annual contract payments only** — no weekly, EOS, highlight, or GOTW coin payouts.",
    "",
    "Use Next to continue server setup.",
  ].join("\n"));
  return {
    embeds: [embed],
    components: [buildNavigationRow()],
  };
}

export function buildLeagueTypeWindow(draft: LeagueSetupDraft) {
  if (draft.game === "cfb_27") {
    const embed = baseEmbed("CFB Setup: Active Rosters", draft)
      .setDescription([
        `League: **${draft.name}**`,
        "",
        "Should rosters actively update to track real-world changes?",
        "",
        "• **On** — player ratings and styles evolve to reflect real-life changes over time.",
        "• **Off** — rosters stay static once set."
      ].join("\n"));
    return {
      embeds: [embed],
      components: [
        selectRow(LEAGUE_SETUP_CUSTOM_IDS.activeRosters, "Active Rosters enabled?", [
          option("On", "yes"),
          option("Off", "no")
        ]),
        buildNavigationRow()
      ]
    };
  }

  return {
    embeds: [baseEmbed("League Setup: League Type", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.leagueType, "Select league type", [
        option("Regular Rosters", "regular_rosters"),
        option("Fantasy Draft", "fantasy_draft"),
        option("Custom Rosters", "custom_rosters"),
        ...(draft.game === "madden_27"
          ? [option("Rise to Immortality", "rise_to_immortality", "10-season career RPG. Store off; Player XP upgrades.")]
          : []),
      ]),
      buildNavigationRow()
    ]
  };
}

