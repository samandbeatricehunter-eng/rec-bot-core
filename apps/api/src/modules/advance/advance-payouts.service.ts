type StagedGame = {
  home_team_external_id: string | null;
  away_team_external_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
};

type LinkedTeam = {
  discordId: string;
  teamName: string | null;
  teamExternalId: string | null;
};

export type AdvancePayout = {
  discordId: string;
  amount: number;
  reason: string;
};

const H2H_WIN = 75;
const H2H_LOSS = 25;
const CPU_WIN = 25;

function findLinkedTeam(teams: LinkedTeam[], externalId: string | null, teamName: string | null) {
  return teams.find((team) => {
    if (externalId && team.teamExternalId && team.teamExternalId === externalId) return true;
    if (teamName && team.teamName && team.teamName.toLowerCase() === teamName.toLowerCase()) return true;
    return false;
  });
}

export function calculateAdvanceGamePayouts(input: { games: StagedGame[]; linkedTeams: LinkedTeam[] }) {
  const payouts: AdvancePayout[] = [];
  const skippedGames: Array<{ reason: string; game: StagedGame }> = [];

  for (const game of input.games) {
    if (typeof game.home_score !== "number" || typeof game.away_score !== "number") {
      skippedGames.push({ reason: "missing_score", game });
      continue;
    }

    if (game.home_score === game.away_score) {
      skippedGames.push({ reason: "tie_no_payout", game });
      continue;
    }

    const home = findLinkedTeam(input.linkedTeams, game.home_team_external_id, game.home_team_name);
    const away = findLinkedTeam(input.linkedTeams, game.away_team_external_id, game.away_team_name);
    const homeWon = game.home_score > game.away_score;
    const winner = homeWon ? home : away;
    const loser = homeWon ? away : home;
    const winnerName = homeWon ? game.home_team_name : game.away_team_name;
    const loserName = homeWon ? game.away_team_name : game.home_team_name;

    if (winner && loser) {
      payouts.push({ discordId: winner.discordId, amount: H2H_WIN, reason: `H2H win vs ${loserName ?? "opponent"}` });
      payouts.push({ discordId: loser.discordId, amount: H2H_LOSS, reason: `H2H loss vs ${winnerName ?? "opponent"}` });
      continue;
    }

    if (winner && !loser) {
      payouts.push({ discordId: winner.discordId, amount: CPU_WIN, reason: `Human win vs CPU ${loserName ?? "opponent"}` });
      continue;
    }

    skippedGames.push({ reason: "cpu_win_or_unlinked_game", game });
  }

  return { payouts, skippedGames };
}
