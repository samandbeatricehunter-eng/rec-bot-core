import { EmbedBuilder } from "discord.js";

function movementArrow(rankChange: number | null): string {
  if (rankChange == null) return "🆕";
  if (rankChange > 0) return `⬆${rankChange}`;
  if (rankChange < 0) return `⬇${Math.abs(rankChange)}`;
  return "➡";
}

function recordText(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function pdText(pd: number): string {
  return pd >= 0 ? `+${pd}` : String(pd);
}

// Builds one or more embeds covering all teams split into pages of `pageSize`.
// Title only on the first embed; subsequent ones are continuation pages.
export function buildPowerRankingsEmbeds(data: {
  rankings: any[];
  leagueName: string;
  completedWeek: number;
  newWeek: number;
}): EmbedBuilder[] {
  const { rankings, leagueName, completedWeek, newWeek } = data;
  if (!rankings.length) {
    return [
      new EmbedBuilder()
        .setTitle(`Power Rankings & Changes (Week ${completedWeek} to Week ${newWeek})`)
        .setDescription("No team data available yet. Import game results to generate rankings.")
    ];
  }

  const PAGE_SIZE = 16;
  const pages: string[][] = [];
  let current: string[] = [];

  for (let i = 0; i < rankings.length; i++) {
    const r = rankings[i];
    const rank = r.rank ?? i + 1;
    const arrow = movementArrow(r.rankChange ?? r.rank_change ?? null);
    const name = r.teamName ?? r.team_name ?? r.abbreviation ?? "Unknown";
    const rec = recordText(r.wins ?? 0, r.losses ?? 0, r.ties ?? 0);
    const pd = pdText(r.pd ?? r.point_differential ?? 0);

    const line = `**${String(rank).padStart(2)} ${arrow}** ${name} | ${rec} | ${pd} PD`;
    current.push(line);

    if (current.length >= PAGE_SIZE || i === rankings.length - 1) {
      pages.push(current);
      current = [];
    }
  }

  return pages.map((lines, pageIdx) => {
    const embed = new EmbedBuilder();
    const title = pageIdx === 0
      ? `Power Rankings & Changes (Week ${completedWeek} to Week ${newWeek})`
      : `Power Rankings (continued)`;
    embed.setTitle(title);
    if (pageIdx === 0) {
      embed.setFooter({ text: `${leagueName} — Season power rankings` });
    }
    embed.setDescription(lines.join("\n"));
    return embed;
  });
}
