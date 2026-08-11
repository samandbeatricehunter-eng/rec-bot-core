// Hand-authored "what would this look like at a different point in the season" snapshots for
// the demo league preview. Real team names/rosters, invented articles/scores/standings — this
// is explicitly presented as a demo, never mixed into the live data paths.
export type DemoPhase = "live" | "week1" | "playoffs" | "championship" | "draft";

export type DemoNewsPost = { id: string; title: string; body: string; createdAt: string };
export type DemoMatchup = { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; status: string; note?: string };
export type DemoStandingRow = { team: string; wins: number; losses: number; ties: number };

export type DemoPhaseContent = {
  phaseLabel: string;
  news: DemoNewsPost[];
  matchupByTeam: Record<string, DemoMatchup>;
  standings: DemoStandingRow[];
  draftBoard?: Array<{ round: number; pick: number; team: string; note: string }>;
};

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString();

export const CFB_DEMO: Partial<Record<DemoPhase, DemoPhaseContent>> = {
  week1: {
    phaseLabel: "Week 1",
    news: [
      { id: "cfb-w1-1", title: "Opening Week: Hard Knox Rolls Into Season Behind a Loaded Front Seven", body: "Hard Knox opens the year as the team to beat after a dominant spring camp, with the defensive line drawing comparisons to last year's conference champions. Coaches around the league are already circling the Week 6 showdown with Ohio State.", createdAt: day(1) },
      { id: "cfb-w1-2", title: "Transfer Portal Additions Pay Off Early for Texas A&M", body: "Two transfer-portal pickups combined for over 250 yards from scrimmage in a statement opening win, giving Texas A&M an early case as a conference dark horse.", createdAt: day(2) },
      { id: "cfb-w1-3", title: "Around the League: Week 1 Storylines", body: "Michigan's ground game looked every bit as physical as advertised, Oklahoma's secondary forced three turnovers in the opener, and Reap U's freshman QB made his first career start look easy.", createdAt: day(3) },
    ],
    matchupByTeam: {
      "Hard Knox": { homeTeam: "Hard Knox", awayTeam: "UAF", homeScore: null, awayScore: null, status: "scheduled" },
      "Michigan": { homeTeam: "Michigan", awayTeam: "Greedy Academy", homeScore: null, awayScore: null, status: "scheduled" },
      "Ohio State": { homeTeam: "Missouri", awayTeam: "Ohio State", homeScore: null, awayScore: null, status: "scheduled" },
      "Oklahoma": { homeTeam: "Oklahoma", awayTeam: "Oregon", homeScore: null, awayScore: null, status: "scheduled" },
      "Texas": { homeTeam: "Texas", awayTeam: "Texas A&M", homeScore: null, awayScore: null, status: "scheduled" },
    },
    standings: [
      { team: "Hard Knox", wins: 0, losses: 0, ties: 0 }, { team: "Michigan", wins: 0, losses: 0, ties: 0 },
      { team: "Ohio State", wins: 0, losses: 0, ties: 0 }, { team: "Oklahoma", wins: 0, losses: 0, ties: 0 },
      { team: "Texas A&M", wins: 0, losses: 0, ties: 0 }, { team: "Reap U", wins: 0, losses: 0, ties: 0 },
      { team: "Oregon", wins: 0, losses: 0, ties: 0 }, { team: "Texas", wins: 0, losses: 0, ties: 0 },
      { team: "Garner College", wins: 0, losses: 0, ties: 0 }, { team: "Greedy Academy", wins: 0, losses: 0, ties: 0 },
    ],
  },
  playoffs: {
    phaseLabel: "CFP First Round",
    news: [
      { id: "cfb-po-1", title: "Selection Show Reaction: Hard Knox Lands a First-Round Bye", body: "A 10-2 regular season and a conference title game win were enough to lock up the No. 3 seed and a bye through the opening round.", createdAt: day(1) },
      { id: "cfb-po-2", title: "Reap U Sneaks In as the Final At-Large", body: "A late-season surge, capped by a road win over Oklahoma, was enough to push Reap U into the field over two one-loss teams left on the outside.", createdAt: day(2) },
      { id: "cfb-po-3", title: "Playoff Preview: Three Games to Watch This Weekend", body: "Michigan's defense against Texas A&M's up-tempo offense headlines a first round that also features two double-digit-win teams meeting a full year ahead of schedule.", createdAt: day(4) },
    ],
    matchupByTeam: {
      "Michigan": { homeTeam: "Michigan", awayTeam: "Texas A&M", homeScore: null, awayScore: null, status: "scheduled", note: "CFP First Round" },
      "Reap U": { homeTeam: "Ohio State", awayTeam: "Reap U", homeScore: null, awayScore: null, status: "scheduled", note: "CFP First Round" },
      "Oklahoma": { homeTeam: "Oklahoma", awayTeam: "Oregon", homeScore: null, awayScore: null, status: "scheduled", note: "CFP First Round" },
    },
    standings: [
      { team: "Hard Knox", wins: 11, losses: 1, ties: 0 }, { team: "Michigan", wins: 10, losses: 2, ties: 0 },
      { team: "Ohio State", wins: 9, losses: 3, ties: 0 }, { team: "Oklahoma", wins: 9, losses: 3, ties: 0 },
      { team: "Texas A&M", wins: 9, losses: 3, ties: 0 }, { team: "Reap U", wins: 8, losses: 4, ties: 0 },
      { team: "Oregon", wins: 8, losses: 4, ties: 0 }, { team: "Texas", wins: 7, losses: 5, ties: 0 },
    ],
  },
  championship: {
    phaseLabel: "National Championship",
    news: [
      { id: "cfb-ch-1", title: "Championship Week Is Here: Hard Knox vs. Michigan for the Title", body: "Two of the sport's most physical fronts collide for the national championship after both teams cut through the bracket without a real scare.", createdAt: day(1) },
      { id: "cfb-ch-2", title: "By the Numbers: A Ground-and-Pound Final", body: "The two finalists rank first and second in the league in rushing yards allowed, setting up what should be a low-scoring, field-position battle for the trophy.", createdAt: day(2) },
      { id: "cfb-ch-3", title: "Season in Review: The Storylines That Defined the Year", body: "From Texas A&M's portal-fueled resurgence to Reap U's freshman quarterback taking the league by surprise, it was a season with no shortage of narratives heading into the final.", createdAt: day(5) },
    ],
    matchupByTeam: {
      "Hard Knox": { homeTeam: "Hard Knox", awayTeam: "Michigan", homeScore: null, awayScore: null, status: "scheduled", note: "National Championship" },
      "Michigan": { homeTeam: "Hard Knox", awayTeam: "Michigan", homeScore: null, awayScore: null, status: "scheduled", note: "National Championship" },
    },
    standings: [
      { team: "Hard Knox", wins: 13, losses: 1, ties: 0 }, { team: "Michigan", wins: 13, losses: 1, ties: 0 },
      { team: "Ohio State", wins: 10, losses: 4, ties: 0 }, { team: "Texas A&M", wins: 10, losses: 4, ties: 0 },
    ],
  },
};

export const MADDEN_DEMO: Partial<Record<DemoPhase, DemoPhaseContent>> = {
  week1: {
    phaseLabel: "Week 1",
    news: [
      { id: "mad-w1-1", title: "Kickoff Week: Ravens Open as the League's Clear Favorite", body: "A near-complete roster and a favorable early schedule have the Ravens penciled in as the team to beat heading into Week 1.", createdAt: day(1) },
      { id: "mad-w1-2", title: "49ers Bring in a Deep Backfield to Wear Down Defenses", body: "San Francisco leans on a two-headed backfield rotation designed to keep fresh legs on the field deep into the fourth quarter.", createdAt: day(2) },
      { id: "mad-w1-3", title: "Around the League: Opening Week Matchups to Watch", body: "Chiefs-Cowboys headlines a loaded Week 1 slate, with both offenses ranked in the top three during the preseason power rankings.", createdAt: day(3) },
    ],
    matchupByTeam: {
      "Baltimore Ravens": { homeTeam: "Baltimore Ravens", awayTeam: "Cleveland Browns", homeScore: null, awayScore: null, status: "scheduled" },
      "San Francisco 49ers": { homeTeam: "San Francisco 49ers", awayTeam: "Los Angeles Rams", homeScore: null, awayScore: null, status: "scheduled" },
      "Kansas City Chiefs": { homeTeam: "Kansas City Chiefs", awayTeam: "Dallas Cowboys", homeScore: null, awayScore: null, status: "scheduled" },
      "Atlanta Falcons": { homeTeam: "Atlanta Falcons", awayTeam: "New Orleans Saints", homeScore: null, awayScore: null, status: "scheduled" },
    },
    standings: [
      { team: "Baltimore Ravens", wins: 0, losses: 0, ties: 0 }, { team: "San Francisco 49ers", wins: 0, losses: 0, ties: 0 },
      { team: "Kansas City Chiefs", wins: 0, losses: 0, ties: 0 }, { team: "Dallas Cowboys", wins: 0, losses: 0, ties: 0 },
      { team: "Atlanta Falcons", wins: 0, losses: 0, ties: 0 }, { team: "Cleveland Browns", wins: 0, losses: 0, ties: 0 },
      { team: "New Orleans Saints", wins: 0, losses: 0, ties: 0 }, { team: "Los Angeles Rams", wins: 0, losses: 0, ties: 0 },
    ],
  },
  playoffs: {
    phaseLabel: "Wild Card Round",
    news: [
      { id: "mad-po-1", title: "Ravens Clinch the One Seed With a Week 17 Win", body: "A dominant second half against a divisional rival locked up home field advantage through the conference championship.", createdAt: day(1) },
      { id: "mad-po-2", title: "Cowboys Sneak Into the Field on Tiebreaker", body: "A better division record edged out a wild-card tiebreaker, sending Dallas into the postseason for the first time this cycle.", createdAt: day(2) },
      { id: "mad-po-3", title: "Wild Card Weekend Preview", body: "Four games, one clear trend: every home team enters as at least a field-goal favorite, but three of the four visiting teams have won on the road already this season.", createdAt: day(3) },
    ],
    matchupByTeam: {
      "Baltimore Ravens": { homeTeam: "Baltimore Ravens", awayTeam: "Dallas Cowboys", homeScore: null, awayScore: null, status: "scheduled", note: "Wild Card Round" },
      "San Francisco 49ers": { homeTeam: "San Francisco 49ers", awayTeam: "Atlanta Falcons", homeScore: null, awayScore: null, status: "scheduled", note: "Wild Card Round" },
    },
    standings: [
      { team: "Baltimore Ravens", wins: 13, losses: 4, ties: 0 }, { team: "San Francisco 49ers", wins: 12, losses: 5, ties: 0 },
      { team: "Kansas City Chiefs", wins: 11, losses: 6, ties: 0 }, { team: "Dallas Cowboys", wins: 10, losses: 7, ties: 0 },
      { team: "Atlanta Falcons", wins: 10, losses: 7, ties: 0 },
    ],
  },
  championship: {
    phaseLabel: "Super Bowl",
    news: [
      { id: "mad-sb-1", title: "Super Bowl Set: Ravens and 49ers Meet for the Title", body: "Both top seeds survived the gauntlet, setting up a championship matchup between the league's best defense and its most explosive offense.", createdAt: day(1) },
      { id: "mad-sb-2", title: "Keys to the Game: Can San Francisco's Backfield Wear Down Baltimore?", body: "The 49ers' rotation-heavy ground game will be tested against a Ravens front seven that's allowed the fewest rushing yards in the league all season.", createdAt: day(2) },
      { id: "mad-sb-3", title: "Season in Review: A Year of Statement Wins", body: "From the Ravens' Week 1 blowout to the Cowboys' surprise wild-card berth, it's been a season of teams peaking at the right time — and now it comes down to one game.", createdAt: day(6) },
    ],
    matchupByTeam: {
      "Baltimore Ravens": { homeTeam: "Baltimore Ravens", awayTeam: "San Francisco 49ers", homeScore: null, awayScore: null, status: "scheduled", note: "Super Bowl" },
      "San Francisco 49ers": { homeTeam: "Baltimore Ravens", awayTeam: "San Francisco 49ers", homeScore: null, awayScore: null, status: "scheduled", note: "Super Bowl" },
    },
    standings: [
      { team: "Baltimore Ravens", wins: 15, losses: 4, ties: 0 }, { team: "San Francisco 49ers", wins: 14, losses: 5, ties: 0 },
    ],
  },
  draft: {
    phaseLabel: "Fantasy Draft",
    news: [
      { id: "mad-dr-1", title: "Draft Night Is Set — Full Order and Start Time Posted", body: "Commissioners have locked the draft order and scheduled tonight's session; every coach has been sent their check-in reminder.", createdAt: day(0) },
      { id: "mad-dr-2", title: "Mock Draft: Who Do the Top Three Picks Take?", body: "Early buzz has the top of the board split between a franchise quarterback and a pass rusher widely considered the best player available regardless of position.", createdAt: day(1) },
      { id: "mad-dr-3", title: "League Roundtable: Biggest Team Needs Heading Into the Draft", body: "Coaches around the league weigh in on the holes they're hoping to fill tonight, from offensive line depth to a true CB1 in the secondary.", createdAt: day(2) },
    ],
    matchupByTeam: {},
    standings: [],
    draftBoard: [
      { round: 1, pick: 1, team: "Cleveland Browns", note: "On the clock — full check-in window open." },
      { round: 1, pick: 2, team: "Atlanta Falcons", note: "On deck." },
      { round: 1, pick: 3, team: "New Orleans Saints", note: "Up next." },
      { round: 1, pick: 4, team: "Los Angeles Rams", note: "Up next." },
    ],
  },
};

export function getDemoPhaseContent(game: string, phase: DemoPhase): DemoPhaseContent | null {
  const table = game === "cfb_27" ? CFB_DEMO : MADDEN_DEMO;
  return table[phase] ?? null;
}
