import { EmbedBuilder } from "discord.js";
import { recApi } from "../lib/rec-api.js";

export async function buildCommissionerToolsEmbed(guildId?: string | null) {
  let header = "Current league information unavailable.";
  let commissioner = "Not linked";
  let compCommittee = "None linked";

  if (guildId) {
    const [week, links] = await Promise.all([
      recApi.viewLeagueWeek(guildId).catch(() => null),
      recApi.getLinkedUsersTeams(guildId).catch(() => null)
    ]);
    const league = week?.league ?? links?.league;
    if (league) {
      const season = league.season_number ?? league.display_season_number ?? "?";
      const weekLabel = league.current_week ? `Week ${league.current_week}` : String(league.season_stage ?? league.current_phase ?? "Stage unknown").replaceAll("_", " ");
      const stage = String(league.season_stage ?? league.current_phase ?? "").replaceAll("_", " ");
      header = `Season ${season}, ${weekLabel}${stage ? ` (${stage})` : ""}`;
    }

    const linked = links?.linked ?? [];
    const authorityOf = (row: any) => String(row.authority ?? row.role ?? row.notes ?? "").toLowerCase();
    const commissioners = linked.filter((row: any) => authorityOf(row).includes("commissioner") && !authorityOf(row).includes("co_commissioner"));
    const comp = linked.filter((row: any) => authorityOf(row).includes("co_commissioner") || authorityOf(row).includes("co-commissioner") || authorityOf(row).includes("comp"));
    commissioner = commissioners[0]?.discordId ? `<@${commissioners[0].discordId}>` : commissioners[0]?.user?.display_name ?? "Not linked";
    const compMentions = comp
      .filter((row: any) => row.discordId !== commissioners[0]?.discordId)
      .map((row: any) => row.discordId ? `<@${row.discordId}>` : row.user?.display_name)
      .filter(Boolean);
    compCommittee = compMentions.length ? compMentions.join(", ") : "None linked";
  }

  return new EmbedBuilder()
    .setTitle("Commissioner Tools")
    .setDescription([
      header,
      "",
      `**Commissioner:** ${commissioner}`,
      `**Comp. Committee (Co-Commish):** ${compCommittee}`,
      "",
      "**Manage League:** Link teams, edit settings/rules/league data, etc..",
      "**Server/League Setup:** Edit Channel links, run the first-time League Setup Wizard, delete league, etc.."
    ].join("\n"));
}

export function buildManageLeagueEmbed() {
  return new EmbedBuilder()
    .setTitle("Manage League")
    .setDescription([
      "Use this menu to manage your leagues operations.",
      "",
      "-**User/Team Linking:** Link users to teams within the league.",
      "-**Troubleshoot Advance:** Failures with advance features, like game channel creation or gotw selection can be addressed using these options.",
      "-**EOS Functions:** If EOS functions such as end of season payouts and REC Awards voting don't commence when league advances to post-season, you can retrigger them via this menu.",
      "-**Active Check:** Posts a poll to the announcements channel tagging everyone with a 24 hour time limit to reply or Commissioners will be notified of failure to respond.",
      "-**Edit League Settings:** Use this menu to edit league settings from the League Setup wizard or view and edit the rules for the league."
    ].join("\n"));
}

export function buildServerLeagueSetupEmbed() {
  return new EmbedBuilder()
    .setTitle("SERVER/LEAGUE SETUP")
    .setDescription([
      "-**Server Setup:** Use this to assign channels for certain bot features to execute. Failure to assign channels will result in certain actions not triggering and possibly causing complications. For game channels. you'll link a category. You will need the channel IDs/category ID, which requires setting your server to DEV mode first in the settings.",
      "",
      "-**League Setup Wizard:** Use this wizard to create the league in REC databases, as well as to designate the leagues settings for user reference. Please run this when setting up a new league for the first time. If you just need to edit individual settings, you'll need to go to Manage League then Edit League Settings to change individual settings without re-running the full wizard. Doing so after the initial run may wipe league data. Please be mindful and aware."
    ].join("\n"));
}

export function buildEosFunctionsEmbed() {
  return new EmbedBuilder()
    .setTitle("EOS Functions")
    .setDescription("Run or repair end-of-season polls, REC Awards voting, and EOS payouts.");
}
