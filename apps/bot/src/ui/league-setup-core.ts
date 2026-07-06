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
        option("Custom Rosters", "custom_rosters")
      ]),
      buildNavigationRow()
    ]
  };
}

