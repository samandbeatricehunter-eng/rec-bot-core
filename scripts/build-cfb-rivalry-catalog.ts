import { writeFile } from "node:fs/promises";
import { CFB_27_TEAMS } from "../packages/shared/src/cfb-teams.js";

const FLOURISH_URL = "https://public.flourish.studio/visualisation/29576177/embed";

type Edge = { source: string; target: string };
type CatalogRow = {
  teamAAbbreviation: string;
  teamBAbbreviation: string;
  rivalryName: string;
  firstYearPlayed: number | null;
  teamAWins: number;
  teamBWins: number;
  ties: number;
  lastGameTeamAScore: number | null;
  lastGameTeamBScore: number | null;
  streakWinnerAbbreviation: string | null;
  streakLength: number;
  verifiedThroughYear: number;
  sourceUrl: string;
};

const ALIASES: Record<string, string> = {
  "Jame Madison": "James Madison", "Miami (FL)": "Miami", "NDSU": "North Dakota State",
};

function normalized(value: string) {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

const WINSIPEDIA_SLUGS: Record<string, string> = {
  "Miami": "miami-fl", "Miami (OH)": "miami-oh", "NC State": "north-carolina-state",
  "Pitt": "pittsburgh", "UMass": "massachusetts", "UConn": "connecticut", "ULM": "louisiana-monroe",
};

function winsipediaSlug(name: string) {
  return WINSIPEDIA_SLUGS[name] ?? name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const teamByName = new Map<string, (typeof CFB_27_TEAMS)[number]>();
for (const team of CFB_27_TEAMS) {
  for (const value of [team.name, `${team.name} ${team.mascot}`, team.abbreviation]) teamByName.set(normalized(value), team);
}

function resolveTeam(raw: string) {
  const value = ALIASES[raw] ?? raw;
  const exact = teamByName.get(normalized(value));
  if (exact) return exact;
  const candidates = CFB_27_TEAMS.filter((team) => normalized(team.name).includes(normalized(value)) || normalized(value).includes(normalized(team.name)));
  if (candidates.length === 1) return candidates[0];
  throw new Error(`Unable to map CFB 27 rivalry team: ${raw}`);
}

async function fetchText(url: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": "REC-Bot rivalry catalog builder/1.0 (local data research)" } });
    if (response.ok) return response.text();
    if (response.status !== 429) throw new Error(`${response.status} fetching ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  throw new Error(`Rate limited fetching ${url}`);
}

async function loadEdges(): Promise<Edge[]> {
  const html = await fetchText(FLOURISH_URL);
  const match = html.match(/_Flourish_data\s*=\s*(\{.*?\}),\s*_Flourish_visualisation_id/s);
  if (!match) throw new Error("Could not locate the CFB 27 Flourish rivalry dataset.");
  return JSON.parse(match[1]).links;
}

function plain(value: string) {
  return value
    .replace(/<!--.*?-->/g, "")
    .replace(/<ref[^>]*>.*?<\/ref>|<ref[^>]*\/>/g, "")
    .replace(/\{\{(?:nowrap|small|nobold)\|([^{}]+)\}\}/gi, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/\{\{.*?\}\}/g, "")
    .replace(/&ndash;|–/g, "-")
    .replace(/&mdash;|—/g, "-")
    .replace(/<br\s*\/?\s*>/gi, " · ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlField(html: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`${escaped}<\\/th><td[^>]*>([\\s\\S]*?)<\\/td>`, "i"))?.[1] ?? "";
}

function scores(value: string) {
  const matches = [...plain(value).matchAll(/(\d+)\s*[-–]\s*(\d+)/g)];
  const last = matches.at(-1);
  return last ? [Number(last[1]), Number(last[2])] as const : [null, null] as const;
}

function recordFor(value: string, teamAName: string, teamBName: string) {
  const clean = plain(value);
  const score = clean.match(/(\d+)\s*[-–]\s*(\d+)(?:\s*[-–]\s*(\d+))?/);
  if (!score) return { a: 0, b: 0, ties: 0 };
  const leaderText = normalized(clean.slice(0, score.index));
  const first = Number(score[1]);
  const second = Number(score[2]);
  const aLeads = leaderText.includes(normalized(teamAName)) || (!leaderText.includes(normalized(teamBName)) && first >= second);
  return { a: aLeads ? first : second, b: aLeads ? second : first, ties: Number(score[3] ?? 0) };
}

async function buildRow(edge: Edge): Promise<CatalogRow> {
  const teamA = resolveTeam(edge.source);
  const teamB = resolveTeam(edge.target);
  const pageTitle = `${teamA.name}–${teamB.name} football rivalry`;
  const sourceUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replaceAll(" ", "_"))}`;
  let html = "";
  try { html = await fetchText(sourceUrl); } catch { /* Some EA-recognized series have no standalone article. */ }
  const heading = plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const rivalryName = heading && !/^\d+\.\d+\.\d+\.\d+$/.test(heading) ? heading : `${teamA.name}-${teamB.name} Rivalry`;
  const firstYear = Number(plain(htmlField(html, "First meeting")).match(/\b(18|19|20)\d{2}\b/)?.[0] ?? 0) || null;
  const record = recordFor(htmlField(html, "All-time series"), teamA.name, teamB.name);
  const latest = plain(htmlField(html, "Latest meeting"));
  const scoreFor = (name: string) => Number(latest.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(\\d+)`, "i"))?.[1] ?? NaN);
  const parsedA = scoreFor(teamA.name);
  const parsedB = scoreFor(teamB.name);
  const fallbackScores = scores(latest);
  const lastA = Number.isFinite(parsedA) ? parsedA : fallbackScores[0];
  const lastB = Number.isFinite(parsedB) ? parsedB : fallbackScores[1];
  const streak = plain(htmlField(html, "Current win streak"));
  const streakLength = Number(streak.match(/\b(\d+)\b/)?.[1] ?? 0);
  const streakWinner = normalized(streak).includes(normalized(teamA.name)) ? teamA.abbreviation
    : normalized(streak).includes(normalized(teamB.name)) ? teamB.abbreviation : null;
  const winsipediaUrl = `https://www.winsipedia.com/${winsipediaSlug(teamA.name)}/vs/${winsipediaSlug(teamB.name)}`;
  let winsipedia = "";
  try { winsipedia = await fetchText(winsipediaUrl); } catch { /* Keep the article-derived fallback. */ }
  const description = plain(winsipedia.match(/<meta name="description" content="([^"]+)"/i)?.[1] ?? "");
  const winsipediaRecord = recordFor(description, teamA.name, teamB.name);
  const winsipediaFirstYear = Number(description.match(/since\s+(\d{4})/i)?.[1] ?? 0) || null;
  const latestGame = winsipedia.match(/"games":\[\{"date":"([^"]+)","year":(\d+),"team1":"([^"]+)","team2":"([^"]+)","team1Score":(\d+),"team2Score":(\d+)/);
  const winsipediaStreak = plain(winsipedia.match(/STREAK<\/div><div[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
  const winsipediaStreakLength = Number(winsipediaStreak.match(/^\s*(\d+)/)?.[1] ?? 0);
  const winsipediaStreakWinner = normalized(winsipediaStreak).includes(normalized(teamA.name)) ? teamA.abbreviation
    : normalized(winsipediaStreak).includes(normalized(teamB.name)) ? teamB.abbreviation : null;
  const hasWinsipediaRecord = winsipediaRecord.a + winsipediaRecord.b + winsipediaRecord.ties > 0;
  return {
    teamAAbbreviation: teamA.abbreviation,
    teamBAbbreviation: teamB.abbreviation,
    rivalryName: rivalryName.slice(0, 64),
    firstYearPlayed: winsipediaFirstYear ?? firstYear,
    teamAWins: hasWinsipediaRecord ? winsipediaRecord.a : record.a,
    teamBWins: hasWinsipediaRecord ? winsipediaRecord.b : record.b,
    ties: hasWinsipediaRecord ? winsipediaRecord.ties : record.ties,
    lastGameTeamAScore: latestGame ? Number(latestGame[5]) : lastA,
    lastGameTeamBScore: latestGame ? Number(latestGame[6]) : lastB,
    streakWinnerAbbreviation: winsipediaStreakWinner ?? streakWinner,
    streakLength: winsipediaStreakLength || streakLength,
    verifiedThroughYear: 2025,
    sourceUrl: hasWinsipediaRecord ? winsipediaUrl : sourceUrl,
  };
}

const edges = await loadEdges();
const rows: CatalogRow[] = [];
const unresolvedEdges: Edge[] = [];
for (const [index, edge] of edges.entries()) {
  try {
    const row = await buildRow(edge);
    rows.push(row);
    if (!row.firstYearPlayed || row.teamAWins + row.teamBWins + row.ties === 0) unresolvedEdges.push(edge);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unable to map")) console.error(`Skipped ${edge.source}-${edge.target}: ${error.message}`);
    else throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  if ((index + 1) % 25 === 0) console.error(`Resolved ${index + 1}/${edges.length} rivalries`);
}

for (const edge of unresolvedEdges) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const repaired = await buildRow(edge);
  const index = rows.findIndex((row) => row.teamAAbbreviation === repaired.teamAAbbreviation && row.teamBAbbreviation === repaired.teamBAbbreviation);
  if (index >= 0 && repaired.teamAWins + repaired.teamBWins + repaired.ties > rows[index].teamAWins + rows[index].teamBWins + rows[index].ties) rows[index] = repaired;
}

rows.sort((a, b) => a.teamAAbbreviation.localeCompare(b.teamAAbbreviation) || a.teamBAbbreviation.localeCompare(b.teamBAbbreviation));
await writeFile(
  new URL("../packages/shared/src/cfb-rivalries.generated.ts", import.meta.url),
  `// Generated by scripts/build-cfb-rivalry-catalog.ts from the CFB 27 in-game network and verified series ledgers.\nexport const CFB_27_RIVALRIES = ${JSON.stringify(rows, null, 2)} as const;\n`,
);
console.log(JSON.stringify({ rivalries: rows.length, missingFirstYear: rows.filter((row) => !row.firstYearPlayed).length, missingRecord: rows.filter((row) => row.teamAWins + row.teamBWins + row.ties === 0).length }));
