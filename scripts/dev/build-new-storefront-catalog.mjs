import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const researchPath = path.join(root, "docs/legends/missing-players-and-character-list.md");
const seedPath = path.join(root, "docs/legends/shared-catalog-seed.json");
const outputPath = path.join(root, "docs/legends/new-storefront-additions.json");
const ratingsPath = path.join(root, "docs/legends/new-storefront-ratings.md");
const discordPath = path.join(root, "docs/legends/new-player-launch-discord.md");
const discordChunksPath = path.join(root, "docs/legends/new-player-launch-discord-chunks.txt");
const migrationPath = path.join(root, "supabase/migrations/20260908220000_identity_refresh_new_storefront_ratings.sql");

const markdown = fs.readFileSync(researchPath, "utf8");
const current = JSON.parse(fs.readFileSync(seedPath, "utf8"));

function between(start, end) {
  const from = markdown.indexOf(start);
  const to = markdown.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing markdown boundary: ${start} -> ${end}`);
  return markdown.slice(from, to);
}

function cleanText(value) {
  return value
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(value) {
  let name = cleanText(value).split(" / ")[0].replace(/\s*\([^)]*\)\s*/g, " ");
  name = name.replace(/\s+[“\"][^”\"]+[”\"]\s+/g, " ").replace(/\s+'[^']+'\s+/g, " ");
  return name.replace(/\s+/g, " ").trim();
}

const POSITION_FIXES = {
  "Will Shields": "RG", "Gene Upshaw": "LG", "Zack Martin": "RG",
  "Walter Jones": "LT", "Gary Zimmerman": "LT", "Cal Hubbard": "RT",
  "Richard Dent": "RE", "Carl Eller": "LE", "Claude Humphrey": "RE", "J.J. Watt": "RE",
  "Kevin Greene": "LOLB", "Andre Tippett": "LOLB", "Rickey Jackson": "ROLB", "Zach Thomas": "MLB",
  "Ken Houston": "SS", "Larry Wilson": "SS", "Emlen Tunnell": "FS", "Earl Thomas": "FS",
  "Justin Tucker": "K", "Jason Elam": "K", "Craig Heyward": "FB", "Billy Johnson": "WR",
  "Antonio Cromartie": "CB", "Conrad Dobler": "RG", "Fred Williamson": "CB",
  "Leon Washington": "HB", "Josh Cribbs": "WR", "Spencer James": "WR", "Vince Papale": "WR",
  "Forrest Gump": "HB", "Earl Wilkinson": "CB", "Kevin Hart": "HB", "Darin Erstad": "P",
  "Louis Rees-Zammit": "HB", "Justin Gatlin": "WR", "O'Shea Jackson": "MLB", "John Cena": "MLB",
};

function normalizePosition(raw, name) {
  if (POSITION_FIXES[name]) return POSITION_FIXES[name];
  const first = cleanText(raw).toUpperCase().split(/[\/ ]/)[0];
  return ({ MIKE: "MLB", WILL: "LOLB", SAM: "ROLB", LB: "MLB", RB: "HB", OT: "LT", OL: "RG", DE: "RE" })[first] ?? first;
}

function parseTables(section, group, subgroup = null) {
  const result = [];
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(cleanText);
    if (cells.length < 3 || /^-+$/.test(cells[0]) || ["Player", "Athlete", "Store identity"].includes(cells[0])) continue;
    const isScreen = group === "celebs_couldve_beens" && subgroup === "screen_star";
    const isCould = group === "celebs_couldve_beens" && subgroup === "couldve_been";
    const name = cleanName(cells[0]);
    const positionIndex = isScreen || isCould ? 2 : 1;
    result.push({
      name,
      position: normalizePosition(cells[positionIndex], name),
      legend_tier: group,
      store_subgroup: subgroup,
      highlight: cleanText(cells.at(-1)),
      performer: isScreen ? cleanText(cells[1]) : null,
    });
  }
  return result;
}

function parsePartOne() {
  const section = between("## Part 1:", "## Part 2:");
  const rows = [];
  let headingPosition = null;
  for (const line of section.split(/\r?\n/)) {
    const heading = line.match(/^### ([A-Z /]+)(?: \(\d+\))?$/);
    if (heading) headingPosition = heading[1];
    const bullet = line.match(/^- \*\*(.+?)\*\* — (.+)$/);
    if (bullet && headingPosition) {
      const name = cleanName(bullet[1]);
      rows.push({ name, position: normalizePosition(headingPosition, name), highlight: cleanText(bullet[2]) });
    }
  }
  const expansion = parseTables(section.slice(section.indexOf("### Expansion slate")), "legend");
  return [...rows, ...expansion].map((row) => ({ ...row, legend_tier: IMMORTALS.has(row.name) ? "immortal" : "legend", store_subgroup: null, performer: null }));
}

const IMMORTALS = new Set([
  "Sid Luckman", "Fran Tarkenton", "Sonny Jurgensen", "Y.A. Tittle", "Bobby Layne", "George Blanda", "Kurt Warner",
  "Curtis Martin", "Frank Gore", "John Henry Johnson", "Tim Brown", "Art Monk", "Lynn Swann", "John Stallworth",
  "Paul Warfield", "Bob Hayes", "Ozzie Newsome", "Will Shields", "Gene Upshaw", "Walter Jones", "Merlin Olsen",
  "Cortez Kennedy", "Buck Buchanan", "Richard Dent", "Carl Eller", "J.J. Watt", "Kevin Greene", "Rickey Jackson",
  "Zach Thomas", "Darrell Green", "Aeneas Williams", "Ken Houston", "Larry Wilson", "Emlen Tunnell", "Justin Tucker",
  "Sterling Sharpe", "Marshal Yanda", "Jared Allen", "Kevin Williams", "James Harrison", "Ronde Barber", "Darren Woodson",
]);

const partOne = parsePartOne();
const busts = parseTables(between("### 2a.", "### 2b."), "bust");
const hometown = parseTables(between("### 2b.", "### 2c."), "hometown_hero");
const screen = parseTables(between("### 3a.", "### 3b."), "celebs_couldve_beens", "screen_star");
const couldve = parseTables(between("### 3b.", "### 3c."), "celebs_couldve_beens", "couldve_been");
const candidates = [...partOne, ...busts, ...hometown, ...screen, ...couldve];
const candidateKeys = new Set(candidates.map((player) => `${player.name.toLowerCase()}|${player.position}`));

const TARGET_OVR = {
  "J.J. Watt": 96, "Walter Jones": 96, "Merlin Olsen": 96, "Fran Tarkenton": 95, "Kurt Warner": 95,
  "Darrell Green": 95, "Justin Tucker": 95, "Sterling Sharpe": 94, "Jared Allen": 94, "Marshal Yanda": 94,
  "Marshawn Lynch": 91, "Steve Smith Sr.": 91, "Philip Rivers": 91, "Jamaal Charles": 90, "Hines Ward": 90,
  "Robert Griffin III": 84, "Ron Dayne": 81, "Trent Richardson": 80, "JaMarcus Russell": 78, "Ryan Leaf": 76,
  "Vernon Gholston": 74, "Roberto Aguayo": 72, "Ryan Fitzpatrick": 85, "Doug Flutie": 85, "Kordell Stewart": 85,
  "Jim McMahon": 84, "Jake Plummer": 84, "Peyton Hillis": 84, "Josh Cribbs": 84, "Pat McAfee": 85,
  "Willie Beamen": 87, "Rod Tidwell": 86, "Paul Crewe": 85, "Bobby Boucher": 84, "Forrest Gump": 84,
  "Lance Harbor": 84, "Jonathan Moxon": 82, "Boobie Miles": 86, "Vince Howard": 84, "Shane Falco": 83,
  "Charlie Ward": 89, "Allen Iverson": 88, "LeBron James": 87, "Jalen Suggs": 87, "Joe Mauer": 87,
  "Kirk Gibson": 89, "Jeff Samardzija": 88, "Jackie Robinson": 89, "Carl Lewis": 87, "Brock Lesnar": 84,
  "Tommie Frazier": 87, "Marcus Dupree": 88, "Eric Crouch": 86, "Wilt Chamberlain": 86, "Usain Bolt": 84,
};

function targetOverall(player) {
  if (TARGET_OVR[player.name]) return TARGET_OVR[player.name];
  const text = player.highlight;
  if (player.legend_tier === "immortal") {
    return /all-time|generational|widely considered|most accurate|14x|12x|MVP|Player of the Year/i.test(text) ? 94 : 93;
  }
  if (player.legend_tier === "legend") {
    return /MVP|first-team All-Pro|triple crown|career leader|Hall of Fame peak/i.test(text) ? 90 : 88;
  }
  // Bust cards model the elite college/draft prospect who entered the league, rather
  // than pretending the disappointing NFL version was already a finished star.
  if (player.legend_tier === "bust") {
    if (/Heisman|No\. 1 overall|first overall|record-setting|dominant college/i.test(text)) return 81;
    if (/top-five|top-10|first-round|elite prospect/i.test(text)) return 78;
    return 76;
  }
  if (player.legend_tier === "hometown_hero") {
    return /Pro Bowl|All-Pro|record|league leader|Super Bowl|1,000/i.test(text) ? 85 : 82;
  }
  if (player.store_subgroup === "screen_star") {
    return /dominant|superstar|unstoppable|elite|Heisman|record/i.test(text) ? 85 : 82;
  }
  return /Heisman|All-American|national title|record|elite|Olympic|world-class/i.test(text) ? 87 : 83;
}

const STYLE_RULES = [
  { tag: "open-field speed", words: /speed|fast|explosive|return|open-field|burst|world-class|Olympic|track/i, deltas: { Speed: 5, Acceleration: 4, Agility: 2, "Change of Direction": 3, "Kick\/Punt Return": 4, Strength: -2 } },
  { tag: "elusive runner", words: /elusive|shifty|cutback|make.*miss|escape|improvis/i, deltas: { Agility: 4, "Change of Direction": 5, "Juke Move": 5, "Spin Move": 3, "Break Tackle": 2 } },
  { tag: "power runner", words: /power|bruis|enforcer|truck|physical|short-yardage|punishing|violent runner/i, deltas: { Strength: 4, Trucking: 6, "Stiff Arm": 4, "Break Tackle": 4, "Impact Blocking": 2, Agility: -2 } },
  { tag: "pocket operator", words: /accur|cerebral|command|intelligen|pocket|distributor|timing|field general/i, deltas: { Awareness: 5, "Short Accuracy": 4, "Medium Accuracy": 5, "Play Action": 3, "Throw Under Pressure": 4, "Throw on the Run": -2 } },
  { tag: "strong arm", words: /big arm|strong arm|arm talent|cannon|vertical passer|deep passer|downfield throw/i, deltas: { "Throwing Power": 6, "Deep Accuracy": 4, "Medium Accuracy": 2 } },
  { tag: "mobile quarterback", words: /scrambl|mobile|dual-threat|option quarterback|option star|running quarterback|Johnny Football|improvisational|running threat|read-option/i, positions: ["QB"], deltas: { Speed: 5, Acceleration: 4, Agility: 4, "Throw on the Run": 5, "Break Sack": 3, Carrying: 2, "Play Action": 2 } },
  { tag: "possession receiver", words: /possession|slot|hands|reliable|volume receiver|chain mover|catch traffic/i, deltas: { Catching: 5, "Catch in Traffic": 5, "Short Route Running": 4, "Medium Route Running": 4, Awareness: 2 } },
  { tag: "vertical receiver", words: /deep threat|vertical|big-play|big play|stretch.*field|downfield/i, deltas: { Speed: 3, Release: 4, "Deep Route Running": 6, "Spectacular Catch": 2 } },
  { tag: "contested-catch target", words: /acrobatic|contested|jump ball|high-point|large target|big target/i, deltas: { Jumping: 5, "Spectacular Catch": 6, "Catch in Traffic": 4, Strength: 2 } },
  { tag: "power blocker", words: /mauler|power blocker|punishing blocker|road grader|physical blocker/i, deltas: { Strength: 5, "Run Blocking": 4, "Run Block Power": 6, "Impact Blocking": 5, "Pass Block Finesse": -2 } },
  { tag: "technician blocker", words: /technician|cerebral anchor|zone-running|blindside protector|pass protector|complete guard/i, deltas: { Awareness: 4, "Pass Blocking": 5, "Pass Block Finesse": 5, "Run Block Finesse": 4 } },
  { tag: "power rusher", words: /power rush|bull rush|interior disrupt|dominant interior|mass|overwhelm/i, deltas: { Strength: 4, "Power Moves": 6, "Block Shedding": 4, "Finesse Moves": -2 } },
  { tag: "speed rusher", words: /edge rush|pass.rush|sack|speed rusher|bend|quick first step/i, deltas: { Acceleration: 4, "Finesse Moves": 6, Pursuit: 4, "Power Moves": -1 } },
  { tag: "run stopper", words: /run.stop|tackling machine|linebacker|nose tackle|inside linebacker/i, deltas: { Tackling: 5, "Block Shedding": 5, Pursuit: 4, "Play Recognition": 4, "Hit Power": 3 } },
  { tag: "man cover corner", words: /shutdown corner|man cover|press corner|lockdown/i, deltas: { "Man Coverage": 6, Press: 5, Speed: 2, "Zone Coverage": -1 } },
  { tag: "zone ballhawk", words: /ballhawk|ball-hawk|interception|safety|range|center field/i, deltas: { "Zone Coverage": 6, "Play Recognition": 5, Catching: 4, Pursuit: 3 } },
  { tag: "big hitter", words: /big hit|hard-hitting|enforcer|intimidat|fearsome/i, deltas: { "Hit Power": 7, Tackling: 3, Toughness: 3 } },
  { tag: "accurate kicker", words: /accurate kicker|accuracy|field goal/i, positions: ["K"], deltas: { "Kicking Accuracy": 7, Awareness: 3 } },
  { tag: "power specialist", words: /strong leg|longest field goal|big leg|punter|punt/i, positions: ["K", "P"], deltas: { "Kicking Power": 7, "Kicking Accuracy": 2 } },
  { tag: "durable competitor", words: /durable|toughness|ironman|played through|long career|20-year/i, deltas: { Stamina: 4, Toughness: 5, Injury: 5 } },
  { tag: "receiving back", words: /receiving back|third-down|dual-purpose|pass-catching back/i, positions: ["HB", "FB"], deltas: { Catching: 5, "Short Route Running": 4, Agility: 3, "BC Vision": 2 } },
  { tag: "raw traits", words: /raw athlete|traits-based|traits bet|testing|prototype frame|physique/i, deltas: { Speed: 2, Acceleration: 2, Strength: 2, Awareness: -5, "Play Recognition": -4 } },
  { tag: "injury risk", words: /injur|knee|concussion|medical/i, deltas: { Injury: -10, Toughness: 2 } },
  { tag: "inconsistent hands", words: /drop|inconsistent hands/i, positions: ["WR", "TE", "HB"], deltas: { Catching: -7, "Catch in Traffic": -4, "Spectacular Catch": -3 } },
  { tag: "spread distributor", words: /run-and-shoot|spread offense|prolific.*pass|record-setting passer/i, positions: ["QB"], deltas: { "Short Accuracy": 4, "Medium Accuracy": 3, "Play Action": -2, Awareness: 1 } },
  { tag: "technical polish", words: /polished|technician|fundamentals|refined|cerebral|smart veteran/i, deltas: { Awareness: 4, Agility: 1, "Play Recognition": 3 } },
  { tag: "championship poise", words: /champion|championship|title game|Super Bowl|national title/i, deltas: { Awareness: 3, "Throw Under Pressure": 3, Toughness: 3 } },
  { tag: "decorated college star", words: /Heisman|All-American|college star|college football hall|player of the year/i, deltas: { Awareness: 3, Stamina: 2, Toughness: 2 } },
  { tag: "production profile", words: /prolific|record-setting|career leader|all-time.*leader|1,000-yard|2,000-yard/i, deltas: { Awareness: 2, Stamina: 3 } },
  { tag: "processing concern", words: /playbook|processing|decision-making|never grasped|mental/i, deltas: { Awareness: -7, "Play Recognition": -5, "Throw Under Pressure": -3 } },
  { tag: "consistency concern", words: /inconsisten|effort|discipline|attitude|off-field|volatile/i, deltas: { Awareness: -5, Stamina: -2, Toughness: -1 } },
  { tag: "oversized frame", words: /6-foot-[5-9]|six-foot-[5-9]|large target|towering|massive|prototype frame|size and strength/i, deltas: { Strength: 4, Jumping: 2, Agility: -2 } },
  { tag: "undersized playmaker", words: /undersized|tiny|small-school|smaller|compact/i, deltas: { Agility: 4, "Change of Direction": 3, Strength: -4 } },
  { tag: "reliable blocker", words: /blocking career|blocking receiver|inline tight end|two-way tight end|lead blocker/i, deltas: { "Run Blocking": 5, "Impact Blocking": 4, "Lead Block": 4 } },
  { tag: "tough competitor", words: /tough|grit|competitive|competitor|hard-nosed|fearless/i, deltas: { Toughness: 6, Stamina: 2, "Break Tackle": 2 } },
  { tag: "ball-security concern", words: /fumble|ball security|turnover-prone/i, deltas: { Carrying: -7, Awareness: -2 } },
  { tag: "special-teams ace", words: /special teams|gunner|return specialist|returner/i, deltas: { "Kick/Punt Return": 6, Speed: 2, Tackling: 2 } },
];

const POSITION_DEFAULT_STYLE = {
  QB: "field-general baseline", HB: "balanced runner baseline", FB: "lead-blocker baseline",
  WR: "route-receiver baseline", TE: "two-way tight-end baseline",
  LT: "blindside-protector baseline", LG: "interior-blocker baseline", C: "line-captain baseline",
  RG: "interior-blocker baseline", RT: "right-tackle baseline",
  LE: "two-way edge baseline", RE: "two-way edge baseline", DT: "interior-anchor baseline",
  LOLB: "pursuit-linebacker baseline", MLB: "field-general linebacker baseline", ROLB: "pursuit-linebacker baseline",
  CB: "coverage-corner baseline", FS: "center-field safety baseline", SS: "box-safety baseline",
  K: "placekicker baseline", P: "punter baseline",
};

// Explicit one-player signatures handle traits that terse roster blurbs cannot safely infer.
// These are football judgments, not name-derived noise; they keep similar-position cards from
// collapsing into a template while preserving the calibrated overall band.
const SIGNATURE_ADJUSTMENTS = {
  "Ki-Jana Carter": { note: "pre-injury home-run burst", deltas: { Speed: 3, Acceleration: 3 } },
  "Tony Mandarich": { note: "exceptional raw weight-room power", deltas: { Strength: 5, "Run Block Power": 3 } },
  "Bruce Matthews": { note: "seven-position technician, pass-set first", deltas: { "Pass Block Finesse": 2, "Pass Blocking": 1, Speed: 2, Strength: -2 } },
  "Gene Upshaw": { note: "Raiders mauler, downhill run-game power", deltas: { Strength: 3, "Run Block Power": 1, "Hit Power": 12, "Pass Block Finesse": -5, "Pass Blocking": -4, Speed: -3 } },
  "Akili Smith": { note: "raw Oregon dual-threat traits, unfinished pocket game", deltas: { Speed: 8, Acceleration: 6, "Throw on the Run": 10, "Throwing Power": 5, "Short Accuracy": -4, "Medium Accuracy": -3, Awareness: -5 } },
  "Brady Quinn": { note: "structured Notre Dame intermediate passer", deltas: { "Medium Accuracy": 6, "Short Accuracy": 3, Speed: -4, "Throw on the Run": -6, "Throwing Power": -2 } },
  "Dan McGwire": { note: "6-8 oversized vertical arm, limited movement", deltas: { "Throwing Power": 8, "Deep Accuracy": 4, Agility: -8, Speed: -6, "Throw on the Run": -8 } },
  "Heath Shuler": { note: "Tennessee athletic movement passer", deltas: { Speed: 10, Acceleration: 7, Agility: 5, "Throw on the Run": 12, "Break Sack": 4, "Short Accuracy": -3 } },
  "Rick Mirer": { note: "early-career play-action comfort, modest arm", deltas: { "Play Action": 7, Awareness: 3, "Throwing Power": -3, Speed: 2 } },
  "Tim Couch": { note: "Kentucky timing passer with pocket toughness", deltas: { Toughness: 6, "Break Sack": 5, "Short Accuracy": 5, "Throwing Power": -4, Speed: -3 } },
  "Todd Marinovich": { note: "rehearsed short-game mechanics, modest arm talent", deltas: { "Short Accuracy": 7, "Play Action": 3, "Throwing Power": -6, "Deep Accuracy": -5, Awareness: -3 } },
  "Ryan Leaf": { note: "cannon-armed Washington State prospect with processing collapse", deltas: { "Throwing Power": 10, "Deep Accuracy": 5, Awareness: -10, "Throw Under Pressure": -8, "Throw on the Run": -6, Toughness: -4 } },
  "JaMarcus Russell": { note: "historic arm talent, accuracy and conditioning drop-off", deltas: { "Throwing Power": 12, "Deep Accuracy": 8, Strength: 4, "Short Accuracy": -8, "Medium Accuracy": -4, Speed: 4, Awareness: -6 } },
  "Johnny Manziel": { note: "Johnny Football scramble-first Heisman creator", deltas: { Speed: 18, Acceleration: 16, Agility: 14, "Throw on the Run": 22, "Break Sack": 10, Carrying: 8, "Juke Move": 6, "Throwing Power": 6, Awareness: -4, "Throw Under Pressure": 4 } },
  "Josh Rosen": { note: "polished UCLA timing passer, limited athlete", deltas: { "Short Accuracy": 4, "Medium Accuracy": 4, Awareness: 5, Speed: -2, "Throw on the Run": -4 } },
  "Matt Leinart": { note: "USC championship timing passer who could still move", deltas: { "Short Accuracy": 5, Awareness: 4, Speed: 6, "Throw on the Run": 8, "Throwing Power": -2 } },
  "Paxton Lynch": { note: "Memphis-sized athlete with unfinished accuracy", deltas: { Speed: 10, Acceleration: 8, "Throwing Power": 7, "Throw on the Run": 10, "Short Accuracy": -5, Awareness: -6 } },
  "David Klingler": { note: "Houston run-and-shoot volume arm", deltas: { "Short Accuracy": 6, "Medium Accuracy": 5, "Throwing Power": 4, Speed: 4, "Play Action": -3 } },
  "Andre Ware": { note: "Heisman run-and-shoot distributor with real mobility", deltas: { Speed: 8, "Throw on the Run": 8, "Short Accuracy": -4, Awareness: 2 } },
  "Robert Griffin III": { note: "2012 dual-threat MVP peak before the knee", deltas: { Speed: 4, Acceleration: 4, "Throw on the Run": 6, "Throwing Power": 3, Awareness: 2 } },
  "Willie Beamen": { note: "Any Given Sunday improvisational third-stringer", deltas: { Speed: 10, Acceleration: 8, Agility: 8, "Throw on the Run": 14, "Break Sack": 6, Awareness: 3 } },
  "Forrest Gump": { note: "straight-line Alabama return speed", deltas: { Speed: 12, Acceleration: 10, "Kick/Punt Return": 10, Agility: -3, Trucking: -4 } },
  "Boobie Miles": { note: "Friday Night Lights home-run back before the knee", deltas: { Speed: 5, Acceleration: 5, Trucking: 4, "Break Tackle": 4, Injury: -8 } },
  "Vince Young": { note: "Texas dual-threat option creator", deltas: { Speed: 8, "Throw on the Run": 8, Carrying: 5, "Throwing Power": 3, "Short Accuracy": -3 } },
  "Jamaal Anderson": { note: "length-first power edge", deltas: { Strength: 3, "Power Moves": 3 } },
  "Peter Warrick": { note: "college open-field creativity", deltas: { Agility: 4, "Juke Move": 4 } },
  "Louis Rees-Zammit": { note: "international rugby acceleration", deltas: { Acceleration: 5, Speed: 3 } },
  "Carl Crawford": { note: "top-tier baseball outfielder speed", deltas: { Speed: 4 } },
  "Derek Starling": { note: "high-volume option running", deltas: { Carrying: 4, "BC Vision": 3 } },
  "Shane Falco": { note: "pressure-tested comeback quarterback", deltas: { "Throw Under Pressure": 4, Toughness: 3 } },
  "Danny Wuerffel": { note: "timing-and-touch distributor without a power arm", deltas: { "Short Accuracy": 4, "Throwing Power": -3 } },
  "Gino Torretta": { note: "traditional pocket field general", deltas: { Awareness: 4, Speed: -3 } },
  "Shaquille O'Neal": { note: "historic mass and play strength", deltas: { Strength: 8, Agility: -4 } },
  "Justin Gatlin": { note: "elite straight-line sprinting", deltas: { Speed: 5, "Change of Direction": -2 } },
  "John Cena": { note: "powerful MIKE projection", deltas: { Strength: 5, "Hit Power": 4 } },
  "Jimmy Dix": { note: "veteran vertical arm talent", deltas: { "Throwing Power": 4 } },
  "Joe Pendleton": { note: "classic rhythm passer", deltas: { "Medium Accuracy": 3 } },
  "Jim Everett": { note: "productive tall pocket passer", deltas: { "Deep Accuracy": 3 } },
  "Tim Tebow": { note: "power-running quarterback", deltas: { Trucking: 6, Strength: 4 } },
  "Vinny Testaverde": { note: "long-career cannon arm", deltas: { "Throwing Power": 4, Stamina: 3 } },
  "Mark Harmon": { note: "college quarterback fundamentals", deltas: { Awareness: 3 } },
  "Doug Flutie": { note: "improvisational undersized scrambler", deltas: { Agility: 5, "Throw on the Run": 4 } },
  "Kordell Stewart": { note: "Slash-level multipurpose athleticism", deltas: { Speed: 5, Catching: 3 } },
  "Ryan Fitzpatrick": { note: "aggressive veteran decision-maker", deltas: { Awareness: 4, "Throw Under Pressure": 3 } },
  "Billy Bob": { note: "Varsity Blues interior mass", deltas: { Strength: 5, "Impact Blocking": 4 } },
  "Cornell Haynes": { note: "compact open-field runner", deltas: { Agility: 4, "Change of Direction": 4 } },
  "Mahershala Ali": { note: "long-striding receiving projection", deltas: { Release: 3, "Medium Route Running": 3 } },
  "Billy Johnson": { note: "White Shoes return electricity", deltas: { "Kick/Punt Return": 6, Agility: 4 } },
  "Elmo Wright": { note: "vertical speed and separation", deltas: { "Deep Route Running": 4, Speed: 3 } },
  "Phil Dawson": { note: "bad-weather placement reliability", deltas: { "Kicking Accuracy": 5 } },
  "Sebastian Janikowski": { note: "generational kicking power", deltas: { "Kicking Power": 7 } },
  "Jim McMahon": { note: "fearless movement and toughness", deltas: { Toughness: 5, "Throw on the Run": 3 } },
  "Kevin Williams": { note: "interior quickness and disruption", deltas: { "Finesse Moves": 4, Acceleration: 2 } },
  "Sonny Jurgensen": { note: "elite pure throwing arm", deltas: { "Throwing Power": 4, "Deep Accuracy": 3 } },
  "Larry Wilson": { note: "safety-blitz pioneer", deltas: { Pursuit: 4, "Hit Power": 3 } },
  "Nick Mangold": { note: "mobile modern center", deltas: { "Run Block Finesse": 4, Agility: 2 } },
  "Olin Kreutz": { note: "physical line-command presence", deltas: { Strength: 3, "Impact Blocking": 3 } },
  "Everson Walls": { note: "instinctive interception production", deltas: { Catching: 5, "Zone Coverage": 3 } },
  "Jeff Saturday": { note: "zone-run technician center", deltas: { "Run Block Finesse": 6, Awareness: 4, Agility: 4 } },
  "Nick Mangold": { note: "mobile modern center", deltas: { "Pass Blocking": 5, "Run Block Finesse": 2, Agility: 3 } },
  "Marshal Yanda": { note: "complete Ravens guard", deltas: { "Pass Blocking": 5, "Run Block Power": 3 } },
  "Richard Sherman": { note: "length-and-ballhawk Seattle corner", deltas: { "Play Recognition": 5, Catching: 5, Press: 4, Speed: -3 } },
  "Eric Weddle": { note: "rangy Chargers center fielder", deltas: { "Play Recognition": 5, "Zone Coverage": 4, Speed: -2 } },
  "Heath Miller": { note: "Steelers two-way in-line tight end", deltas: { "Run Blocking": 5, Catching: 3, Speed: -3 } },
  "Kevin White": { note: "West Virginia vertical tester", deltas: { Speed: 6, Acceleration: 4, Catching: -4, "Spectacular Catch": -2 } },
  "Jim Everett": { note: "productive tall pocket passer", deltas: { "Deep Accuracy": 5, "Throwing Power": 4, Speed: -4, "Throw on the Run": -5 } },
  "Brent Grimes": { note: "undersized undrafted ballhawk", deltas: { "Zone Coverage": 5, Catching: 4, Speed: 3, Press: -3 } },
  "Rudy Ruettiger": { note: "walk-on special-teams spark", deltas: { Stamina: 6, Toughness: 6, Speed: -5, Strength: -4 } },
  "Darnell Jefferson": { note: "The Program home-run back", deltas: { Speed: 7, Acceleration: 6, Trucking: -3, "Juke Move": 5 } },
  "Earl Megget": { note: "The Program darting return back", deltas: { Agility: 6, "Kick/Punt Return": 7, Trucking: -4, Speed: 2 } },
  "Billy Bob": { note: "Varsity Blues interior mass", deltas: { Strength: 7, "Impact Blocking": 5, "Pass Blocking": -3 } },
  "Bill Goldberg": { note: "wrestling-power interior disruptor", deltas: { "Power Moves": 6, Strength: 4, Agility: -5 } },
  "Zdeno Chara": { note: "historic length and reach at DT", deltas: { Strength: 6, "Block Shedding": 5, Agility: -6 } },
  "Frank Thomas": { note: "Big Hurt play-strength mismatch", deltas: { Strength: 5, "Hit Power": 4, "Power Moves": 3 } },
  "Will Shields": { note: "Chiefs ironman technician", deltas: { "Pass Block Finesse": 5, Stamina: 5, Awareness: 3 } },
  "Emmitt Thomas": { note: "Chiefs ballhawk production", deltas: { Catching: 6, "Play Recognition": 4, Speed: -2 } },
  "Everson Walls": { note: "instinctive interception production", deltas: { "Zone Coverage": 5, Catching: 4, Press: -3 } },
  "Earl Thomas": { note: "Seattle rangy center fielder", deltas: { Speed: 5, "Zone Coverage": 4, "Play Recognition": 3 } },
  "Mark Bavaro": { note: "Giants physical two-way tight end", deltas: { "Run Blocking": 4, Strength: 4, Catching: 2 } },
  "Charles Rogers": { note: "Michigan State vertical speed", deltas: { Speed: 5, "Deep Route Running": 5, Catching: -5 } },
  "Tim Tebow": { note: "power-running quarterback", deltas: { Trucking: 6, Strength: 4, Speed: 6, "Throw on the Run": 8, "Short Accuracy": -4 } },
  "Fred Williamson": { note: "Hammer press-man physical corner", deltas: { Press: 6, "Hit Power": 5, "Man Coverage": 3 } },
  "Vernon Littlefield": { note: "The Replacements special-teams scrapper", deltas: { Tackling: 4, Stamina: 4, Speed: 3 } },
  "Willie Anderson": { note: "elite right-side pass protection", deltas: { "Pass Blocking": 6, "Pass Block Power": 5, Strength: 2 } },
  "George Blanda": { note: "longevity kicker-quarterback hybrid toughness", deltas: { Stamina: 6, Toughness: 5, "Kicking Power": 8, "Kicking Accuracy": 6, Speed: -4 } },
  "Jeff Saturday": { note: "zone-run technician center", deltas: { "Run Block Finesse": 5, Agility: 4, "Pass Block Finesse": 3 } },
  "Olin Kreutz": { note: "physical line-command presence", deltas: { Strength: 5, "Impact Blocking": 5, "Run Block Power": 4 } },
  "Kevin Williams": { note: "interior quickness and disruption", deltas: { "Finesse Moves": 6, Acceleration: 4, "Power Moves": 2 } },
  "Jared Allen": { note: "bend-and-burst edge production", deltas: { "Finesse Moves": 5, Pursuit: 4, Acceleration: 3 } },
  "Everson Walls": { note: "instinctive interception production", deltas: { Catching: 6, "Zone Coverage": 4 } },
  "Larry Wilson": { note: "safety-blitz pioneer", deltas: { Pursuit: 5, "Hit Power": 4 } },
  "Steven Jackson": { note: "workhorse between-the-tackles runner", deltas: { Trucking: 5, Stamina: 5, "Break Tackle": 4, Speed: -3 } },
  "Blair Thomas": { note: "Penn State home-run burst that never translated", deltas: { Speed: 5, Acceleration: 4, "Break Tackle": -3 } },
  "Peter Warrick": { note: "college open-field creativity", deltas: { Agility: 6, "Juke Move": 6, "Kick/Punt Return": 5 } },
  "David Terrell": { note: "Michigan contested-catch size", deltas: { "Catch in Traffic": 5, Jumping: 4, Strength: 3, Speed: -3 } },
  "Robert Gallery": { note: "Iowa mauler who stalled in pass protection", deltas: { "Run Block Power": 5, Strength: 4, "Pass Block Finesse": -4 } },
  "Matthew Jones": { note: "Arkansas big-play speed with drop issues", deltas: { Speed: 5, "Deep Route Running": 4, Catching: -4 } },
  "Derrick Harvey": { note: "Florida athletic edge with unfinished power", deltas: { Acceleration: 4, "Finesse Moves": 4, "Power Moves": -3 } },
  "Fred Jackson": { note: "undrafted receiving back with vision", deltas: { "BC Vision": 5, Catching: 4, "Short Route Running": 4, Trucking: -2 } },
  "Billy Cundiff": { note: "strong-leg kickoff specialist", deltas: { "Kicking Power": 6, "Kicking Accuracy": -3 } },
  "Adam Dunn": { note: "oversized power-hitting baseball crossover", deltas: { Strength: 6, "Throwing Power": 4, Agility: -5, Speed: -4 } },
  "Derek Starling": { note: "high-volume option running", deltas: { Carrying: 5, "BC Vision": 4, Speed: 3 } },
  "Jumbo Fumiko": { note: "The Replacements interior mass", deltas: { Strength: 6, "Run Block Power": 5, Agility: -4 } },
  "Steve Austin": { note: "Stone Cold MIKE enforcer", deltas: { "Hit Power": 7, Toughness: 5, Tackling: 3 } },
  "Darnell Jefferson": { note: "The Program home-run back", deltas: { Speed: 5, Acceleration: 4, "Juke Move": 4 } },
  "Christopher Bridges": { note: "Ludacris receiving-back juice", deltas: { Catching: 5, Agility: 4, "Kick/Punt Return": 4 } },
  "Billy Bob": { note: "Varsity Blues interior mass", deltas: { Strength: 6, "Impact Blocking": 5 } },
  "Flash Gordon": { note: "The Replacements scramble showman", deltas: { Speed: 6, Agility: 5, "Throw on the Run": 6 } },
  "Calvin Broadus": { note: "Snoop compact slot creativity", deltas: { Agility: 5, "Juke Move": 5, "Short Route Running": 4 } },
  "Cornell Haynes": { note: "Nelly compact open-field runner", deltas: { Agility: 5, "Change of Direction": 5, Speed: 3 } },
  "Mahershala Ali": { note: "long-striding receiving projection", deltas: { Release: 4, "Medium Route Running": 4, Jumping: 3 } },
  "Jason White": { note: "Oklahoma timing Heisman passer", deltas: { "Short Accuracy": 5, "Medium Accuracy": 4, Speed: -4, "Throw on the Run": -4 } },
  "Zion Williamson": { note: "Duke burst and play strength at TE", deltas: { Acceleration: 6, Strength: 5, Jumping: 4, "Break Tackle": 4 } },
  "Justin Gatlin": { note: "elite straight-line sprinting", deltas: { Speed: 7, "Change of Direction": -4, Catching: -3 } },
  "Joel Embiid": { note: "seven-foot interior length", deltas: { Jumping: 5, Strength: 4, Agility: -3 } },
  "Giannis Antetokounmpo": { note: "freakish length and first-step burst", deltas: { Acceleration: 6, Speed: 5, Agility: 3, Strength: 3 } },
  "Chris Weinke": { note: "Florida State pocket veteran, late bloomer", deltas: { Awareness: 5, "Medium Accuracy": 4, Speed: -5, "Throw on the Run": -5 } },
  "Major Harris": { note: "West Virginia option creator", deltas: { Speed: 6, Carrying: 5, "Throw on the Run": 6, "Throwing Power": -3 } },
  "Cal Hubbard": { note: "two-way pioneer mass at tackle", deltas: { Strength: 5, "Impact Blocking": 5, "Run Block Power": 4 } },
  "Buck Buchanan": { note: "Chiefs interior length and pursuit", deltas: { Pursuit: 5, "Block Shedding": 4, Acceleration: 3 } },
  "Richard Dent": { note: "46 defense speed-to-power closer", deltas: { "Finesse Moves": 4, "Power Moves": 3, Pursuit: 4 } },
  "Emmitt Thomas": { note: "Chiefs ballhawk production", deltas: { Catching: 5, "Play Recognition": 4, "Zone Coverage": 3 } },
  "Ken Houston": { note: "Oilers/Redskins box-safety thumper", deltas: { "Hit Power": 5, Tackling: 4, Strength: 3 } },
  "Tiki Barber": { note: "elusive receiving back with late-career burst", deltas: { Agility: 5, "Juke Move": 5, Catching: 4, Trucking: -3 } },
  "Curtis Enis": { note: "Penn State power back, limited homerun speed", deltas: { Trucking: 5, Strength: 4, Speed: -4 } },
  "Troy Williamson": { note: "track-speed deep threat with drop issues", deltas: { Speed: 6, "Deep Route Running": 5, Catching: -5 } },
  "Tony Mandarich": { note: "exceptional raw weight-room power", deltas: { Strength: 6, "Run Block Power": 4, "Pass Block Finesse": -3 } },
  "Reggie Williams": { note: "Washington contested-catch size", deltas: { "Catch in Traffic": 5, Strength: 3, Speed: -2 } },
  "Jamaal Anderson": { note: "length-first power edge", deltas: { Strength: 4, "Power Moves": 4, Acceleration: -2 } },
  "Duane Thomas": { note: "Cowboys power-and-vision runner", deltas: { "BC Vision": 5, Trucking: 4, Stamina: 3 } },
  "Phil Dawson": { note: "bad-weather placement reliability", deltas: { "Kicking Accuracy": 6, "Kicking Power": -2 } },
  "Shane Falco": { note: "pressure-tested comeback quarterback", deltas: { "Throw Under Pressure": 5, Toughness: 4 } },
  "Charles Greane": { note: "The Replacements right-side mauler", deltas: { Strength: 5, "Run Blocking": 4 } },
  "Daniel Bateman": { note: "Any Given Sunday unhinged MIKE", deltas: { "Hit Power": 6, Pursuit: 4, Awareness: -3 } },
  "Earl Megget": { note: "The Program darting return back", deltas: { Speed: 5, Agility: 5, "Kick/Punt Return": 6 } },
  "Bill Goldberg": { note: "wrestling-power interior disruptor", deltas: { Strength: 6, "Power Moves": 5, Agility: -4 } },
  "Joe Pendleton": { note: "classic rhythm passer", deltas: { "Medium Accuracy": 5, "Play Action": 3 } },
  "Charlie Tweeder": { note: "Varsity Blues vertical showman", deltas: { Speed: 4, "Spectacular Catch": 4, "Deep Route Running": 3 } },
  "Joe Mauer": { note: "catcher-athlete timing and hands", deltas: { Catching: 5, Awareness: 4, "Throwing Power": -3 } },
  "Dave Winfield": { note: "6-6 athletic mismatch tight end", deltas: { Jumping: 5, Catching: 4, Speed: 3 } },
  "Carl Lewis": { note: "Olympic sprint deep threat", deltas: { Speed: 8, Acceleration: 6, Catching: -4 } },
  "Zdeno Chara": { note: "historic length and reach at DT", deltas: { Strength: 5, "Block Shedding": 4, Agility: -5 } },
  "Shaquille O'Neal": { note: "historic mass and play strength", deltas: { Strength: 10, Agility: -6, Jumping: 3 } },
  "Ty Detmer": { note: "BYU timing-and-touch Heisman arm", deltas: { "Short Accuracy": 6, "Medium Accuracy": 5, "Throwing Power": -5, Speed: -3 } },
  "Tommie Frazier": { note: "Nebraska option-power quarterback", deltas: { Trucking: 5, Strength: 4, Speed: 4, "Throwing Power": -2 } },
  "Bobby Layne": { note: "two-minute toughness and leadership", deltas: { Toughness: 5, "Throw Under Pressure": 4, Awareness: 3 } },
  "John Cena": { note: "powerful MIKE projection", deltas: { Strength: 6, "Hit Power": 5 } },
  "Nick Mangold": { note: "mobile modern center", deltas: { "Pass Blocking": 5, "Run Block Finesse": 2, Agility: 3 } },
  "Jeff Saturday": { note: "zone-run technician center", deltas: { "Run Block Finesse": 6, Awareness: 4, Agility: 4 } },
  "Will Shields": { note: "Chiefs ironman technician", deltas: { "Pass Blocking": 2, "Run Block Power": -2, Stamina: 5 } },
  "Marshal Yanda": { note: "complete Ravens guard", deltas: { "Pass Blocking": 5, "Run Block Power": 4 } },
  "Richard Sherman": { note: "length-and-ballhawk Seattle corner", deltas: { Press: 5, Speed: -4, "Man Coverage": 3 } },
  "Emmitt Thomas": { note: "Chiefs ballhawk production", deltas: { "Man Coverage": -2, Speed: 2, Press: -3 } },
  "Everson Walls": { note: "instinctive interception production", deltas: { Press: -4, Speed: -3, "Man Coverage": 2 } },
  "Earl Thomas": { note: "Seattle rangy center fielder", deltas: { Speed: 5, "Zone Coverage": 4, "Play Recognition": 3 } },
  "Eric Weddle": { note: "rangy Chargers center fielder", deltas: { Speed: -3, "Play Recognition": 5, "Zone Coverage": 2 } },
  "Mark Bavaro": { note: "Giants physical two-way tight end", deltas: { "Run Blocking": 5, Speed: -4 } },
  "Heath Miller": { note: "Steelers two-way in-line tight end", deltas: { Catching: 4, Speed: 2, "Run Blocking": 2 } },
  "Charles Rogers": { note: "Michigan State vertical speed", deltas: { Speed: 5, Catching: -6, "Spectacular Catch": -3 } },
  "Kevin White": { note: "West Virginia vertical tester", deltas: { Speed: 3, Catching: -2, "Spectacular Catch": 3 } },
  "Tim Tebow": { note: "power-running quarterback", deltas: { Speed: 7, "Throw on the Run": 9, "Short Accuracy": -5, "Throwing Power": 2 } },
  "Jim Everett": { note: "productive tall pocket passer", deltas: { Speed: -5, "Throw on the Run": -6, "Throwing Power": 5, "Short Accuracy": 3 } },
  "Fred Williamson": { note: "Hammer press-man physical corner", deltas: { Press: 6, "Man Coverage": 4, Speed: -2 } },
  "Brent Grimes": { note: "undersized undrafted ballhawk", deltas: { Press: -4, Speed: 4, "Man Coverage": 2 } },
  "Vernon Littlefield": { note: "The Replacements special-teams scrapper", deltas: { Speed: 4, Strength: -3 } },
  "Rudy Ruettiger": { note: "walk-on special-teams spark", deltas: { Speed: -6, Strength: -4, Stamina: 6 } },
  "Earl Megget": { note: "The Program darting return back", deltas: { Speed: 3, Trucking: -5, "Juke Move": 5 } },
  "Darnell Jefferson": { note: "The Program home-run back", deltas: { Speed: 7, Trucking: 3, "Juke Move": 2 } },
  "Billy Bob": { note: "Varsity Blues interior mass", deltas: { Strength: 7, "Pass Blocking": -4 } },
  "Bill Goldberg": { note: "wrestling-power interior disruptor", deltas: { Strength: 4, "Power Moves": 6, "Pass Blocking": 3 } },
  "Zdeno Chara": { note: "historic length and reach at DT", deltas: { Strength: 7, "Block Shedding": 5, "Power Moves": 2 } },
  "Frank Thomas": { note: "Big Hurt play-strength mismatch at tight end", deltas: { Catching: 4, Speed: 3, Jumping: 4, "Run Blocking": 2 } },
  "Zdeno Chara": { note: "6-9 engulfing blocker with limited COD", deltas: { "Run Blocking": 6, Speed: -5, Jumping: -3, Catching: -3 } },
  "Vernon Littlefield": { note: "Ballers/UCLA athletic edge", deltas: { "Finesse Moves": 5, Pursuit: 4, "Power Moves": 2 } },
  "Rudy Ruettiger": { note: "walk-on motor over traits", deltas: { "Finesse Moves": -6, "Power Moves": -6, Pursuit: 5, Toughness: 6 } },
  "Doug Williams": { note: "Super Bowl XXII MVP vertical striker", deltas: { "Throwing Power": 5, "Deep Accuracy": 5, "Throw Under Pressure": 4, Speed: 2 } },
  "Ken Anderson": { note: "precision West Coast precursor", deltas: { "Short Accuracy": 6, "Throwing Power": -4, Speed: -3, "Throw on the Run": -3 } },
};

function playerStyles(player) {
  const text = `${player.highlight} ${player.position}`;
  const matched = STYLE_RULES.filter((rule) => (!rule.positions || rule.positions.includes(player.position)) && rule.words.test(text));
  return matched.length ? matched : [{ tag: POSITION_DEFAULT_STYLE[player.position] ?? `${player.position} baseline`, deltas: {} }];
}

function chooseComparator(player, ovr, focus) {
  const samePosition = current.filter((row) => row.position === player.position && !candidateKeys.has(`${row.name.toLowerCase()}|${row.position}`));
  if (!samePosition.length) throw new Error(`No comparator for ${player.name} at ${player.position}`);
  return samePosition
    .map((row) => ({ row, score: Math.abs(Number(row.est_ovr) - ovr) * 5 - focus.reduce((sum, attr) => sum + ((row.attributes?.[attr] ?? 0) / 100), 0) }))
    .sort((a, b) => a.score - b.score || a.row.name.localeCompare(b.row.name))[0].row;
}

function clamp(value) { return Math.max(15, Math.min(99, Math.round(value))); }

function makeAttributes(player, comparator, ovr, styles) {
  const delta = Number(comparator.est_ovr) - ovr;
  const attrs = Object.fromEntries(Object.entries(comparator.attributes).map(([key, value]) => {
    const numeric = Number(value);
    const reduction = numeric >= 80 ? delta : numeric >= 55 ? delta * 0.6 : delta * 0.25;
    return [key, clamp(numeric - reduction)];
  }));
  const categoryScale = player.legend_tier === "bust" ? 1 : player.legend_tier === "hometown_hero" ? 0.9 : 0.8;
  for (const style of styles) {
    for (const [key, value] of Object.entries(style.deltas)) {
      if (key in attrs) attrs[key] = clamp(attrs[key] + value * categoryScale);
    }
  }
  const signature = SIGNATURE_ADJUSTMENTS[player.name];
  if (signature) {
    for (const [key, value] of Object.entries(signature.deltas)) {
      if (key in attrs) attrs[key] = clamp(attrs[key] + value);
    }
  }
  return attrs;
}

function positionGroup(position) {
  return ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "K"].includes(position) ? "offense" : "defense";
}

function bodyType(position) {
  if (["LT", "LG", "C", "RG", "RT", "DT"].includes(position)) return "heavy";
  if (["LE", "RE", "TE", "MLB", "LOLB", "ROLB", "FB"].includes(position)) return "muscular";
  return "standard";
}

function abilitiesFor(player) {
  if (player.legend_tier !== "legend" && player.legend_tier !== "immortal") return [];
  const type = player.legend_tier === "immortal" ? "xfactor" : "superstar";
  const byPosition = {
    QB: "Field General", HB: "Backfield Master", FB: "Tank", WR: "Route Technician", TE: "Matchup Nightmare",
    LT: "Edge Protector", LG: "Post Up", C: "Linchpin", RG: "Post Up", RT: "Edge Protector",
    LE: "Unstoppable Force", RE: "Unstoppable Force", DT: "Run Stuffer", LOLB: "Edge Threat", MLB: "Run Stuffer",
    ROLB: "Edge Threat", CB: "Shutdown", FS: "Zone Hawk", SS: "Reinforcement", K: "Clutch Kicker", P: "Precision Punter",
  };
  return [{ name: byPosition[player.position] ?? "Veteran Presence", type, description: `Curated ${type} ability for this ${player.position} build.` }];
}

const existingKey = new Set(current.map((row) => `${row.name.toLowerCase()}|${row.position}`).filter((key) => !candidateKeys.has(key)));
const seen = new Set();
const profiles = candidates.map((player) => {
  const key = `${player.name.toLowerCase()}|${player.position}`;
  if (seen.has(key)) throw new Error(`Duplicate launch candidate: ${key}`);
  if (existingKey.has(key)) throw new Error(`Candidate already exists in shared catalog: ${key}`);
  seen.add(key);
  const est_ovr = targetOverall(player);
  const styles = playerStyles(player);
  const focus = [...new Set(styles.flatMap((style) => Object.entries(style.deltas).filter(([, value]) => value > 0).map(([key]) => key)))];
  const comparator = chooseComparator(player, est_ovr, focus);
  return {
    name: player.name,
    position: player.position,
    position_group: positionGroup(player.position),
    legend_tier: player.legend_tier,
    store_subgroup: player.store_subgroup,
    dev_trait: player.legend_tier === "immortal" ? "xfactor" : player.legend_tier === "bust" ? "star" : "superstar",
    est_ovr,
    height: null,
    weight: null,
    hand: "Right",
    jersey_number: null,
    archetype: `${player.position} / ${styles.map((style) => style.tag).join(" + ")}`,
    build_note: player.highlight,
    college: null,
    body_type: bodyType(player.position),
    photo_url: null,
    attributes: makeAttributes(player, comparator, est_ovr, styles),
    abilities: abilitiesFor(player),
    catalog_group: "notable_addition",
    ratings_basis: { comparator: comparator.name, comparator_ovr: comparator.est_ovr, style_tags: styles.map((style) => style.tag), signature: SIGNATURE_ADJUSTMENTS[player.name]?.note ?? null, focus_attributes: focus },
    performer: player.performer,
  };
});

const expected = { immortal: 42, legend: 41, bust: 52, hometown_hero: 46, screen_star: 65, couldve_been: 50 };
const actual = {
  immortal: profiles.filter((p) => p.legend_tier === "immortal").length,
  legend: profiles.filter((p) => p.legend_tier === "legend").length,
  bust: profiles.filter((p) => p.legend_tier === "bust").length,
  hometown_hero: profiles.filter((p) => p.legend_tier === "hometown_hero").length,
  screen_star: profiles.filter((p) => p.store_subgroup === "screen_star").length,
  couldve_been: profiles.filter((p) => p.store_subgroup === "couldve_been").length,
};
for (const [group, count] of Object.entries(expected)) if (actual[group] !== count) throw new Error(`${group}: expected ${count}, got ${actual[group]}`);

for (const player of profiles) {
  if (Object.keys(player.attributes).length < 50) throw new Error(`Incomplete attribute profile: ${player.name}`);
  for (const [attribute, value] of Object.entries(player.attributes)) {
    if (!Number.isInteger(value) || value < 15 || value > 99) throw new Error(`Invalid ${attribute} for ${player.name}: ${value}`);
  }
}

const identityKeysByPosition = {
  QB: ["Speed", "Throwing Power", "Throw on the Run", "Awareness", "Short Accuracy"],
  HB: ["Speed", "Trucking", "Juke Move", "Carrying", "BC Vision"],
  FB: ["Lead Block", "Trucking", "Strength"],
  WR: ["Speed", "Catching", "Deep Route Running", "Spectacular Catch", "Agility"],
  TE: ["Catching", "Run Blocking", "Speed", "Jumping"],
  LT: ["Pass Blocking", "Run Block Power", "Strength"],
  LG: ["Run Blocking", "Pass Blocking", "Strength"],
  C: ["Pass Blocking", "Run Block Finesse", "Awareness"],
  RG: ["Run Block Power", "Pass Blocking", "Strength"],
  RT: ["Pass Blocking", "Run Block Power", "Strength"],
  LE: ["Finesse Moves", "Power Moves", "Pursuit"],
  RE: ["Finesse Moves", "Power Moves", "Pursuit"],
  DT: ["Power Moves", "Block Shedding", "Strength"],
  LOLB: ["Pursuit", "Tackling", "Finesse Moves"],
  MLB: ["Tackling", "Hit Power", "Play Recognition"],
  ROLB: ["Pursuit", "Tackling", "Finesse Moves"],
  CB: ["Man Coverage", "Speed", "Press"],
  FS: ["Zone Coverage", "Play Recognition", "Speed"],
  SS: ["Hit Power", "Zone Coverage", "Tackling"],
  K: ["Kicking Power", "Kicking Accuracy", "Awareness"],
  P: ["Kicking Power", "Kicking Accuracy", "Awareness"],
};
const identityGroups = new Map();
for (const player of profiles) {
  const keys = identityKeysByPosition[player.position] ?? ["Speed", "Awareness", "Strength"];
  const fingerprint = keys.map((key) => `${key}:${player.attributes[key] ?? 0}`).join("|");
  const groupKey = `${player.legend_tier}|${player.store_subgroup ?? ""}|${player.position}|${fingerprint}`;
  const names = identityGroups.get(groupKey) ?? [];
  names.push(player.name);
  identityGroups.set(groupKey, names);
}
const clones = [...identityGroups.values()].filter((names) => names.length > 1);
if (clones.length) throw new Error(`Identical attribute fingerprints: ${clones.map((names) => names.join(" / ")).join("; ")}`);

profiles.sort((a, b) => a.legend_tier.localeCompare(b.legend_tier) || (a.store_subgroup ?? "").localeCompare(b.store_subgroup ?? "") || a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
fs.writeFileSync(outputPath, `${JSON.stringify({ generated_at: "2026-09-08", methodology: "Same-position Madden calibration with career/portrayal-specific play-style deltas. Busts model their college/draft prospect identity; fictional and crossover players use documented athletic traits. No random attribute adjustments are used.", counts: actual, players: profiles }, null, 2)}\n`);
const mergedSeed = [...current.filter((row) => !candidateKeys.has(`${row.name.toLowerCase()}|${row.position}`)), ...profiles]
  .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
fs.writeFileSync(seedPath, `${JSON.stringify(mergedSeed, null, 2)}\n`);

const labels = { immortal: "Immortals", legend: "Legends", bust: "NFL Busts", hometown_hero: "Hometown Heroes", screen_star: "Screen Stars", couldve_been: "Could've Beens" };
const sections = [
  ["immortal", (p) => p.legend_tier === "immortal"], ["legend", (p) => p.legend_tier === "legend"],
  ["bust", (p) => p.legend_tier === "bust"], ["hometown_hero", (p) => p.legend_tier === "hometown_hero"],
  ["screen_star", (p) => p.store_subgroup === "screen_star"], ["couldve_been", (p) => p.store_subgroup === "couldve_been"],
];
let ratings = "# New storefront roster and ratings review\n\nBusts are Star dev and cost 2,000 coins. Hometown Heroes, Screen Stars, and Could've Beens are Superstar dev and cost 4,000. Full 50+ attribute maps are in `new-storefront-additions.json`.\n";
let discord = "# Discord announcement — all new storefront additions\n\n**296 NEW PLAYERS ARE JOINING THE REC STORE TODAY**\n\nWe are expanding every corner of the player store: 42 Immortals, 41 Legends, 52 NFL Busts, 46 Hometown Heroes, 65 Screen Stars, and 50 Could've Beens.\n\n**PRICE + DEV GUIDE**\n• Immortals — 8,000 coins / X-Factor\n• Legends — 4,000 coins / Superstar\n• NFL Busts — 2,000 coins / Star\n• Hometown Heroes — 4,000 coins / Superstar\n• Screen Stars — 4,000 coins / Superstar\n• Could've Beens — 4,000 coins / Superstar\n• Existing 1,000-coin special-teams pricing still applies to Legend/Immortal K and P cards.\n\nThe shared seasonal limit across every group above is now **four player purchases per team**, up from three.\n";
for (const [key, predicate] of sections) {
  const rows = profiles.filter(predicate);
  ratings += `\n## ${labels[key]} (${rows.length})\n\n| Player | Pos | OVR | Dev | Rating identity | Comparator |\n|---|---:|---:|---|---|---|\n`;
  discord += `\n## ${labels[key]} (${rows.length})\n`;
  for (const p of rows) {
    ratings += `| ${p.name} | ${p.position} | ${p.est_ovr} | ${p.dev_trait} | ${p.ratings_basis.focus_attributes.slice(0, 3).join(", ") || "Balanced"} | ${p.ratings_basis.comparator} |\n`;
    discord += `\n**${p.name} — ${p.position}, ${p.est_ovr} OVR** · ${p.build_note}`;
    if (p.performer) discord += ` Portrayed by ${p.performer}.`;
    discord += "\n";
  }
}
fs.writeFileSync(ratingsPath, ratings);
fs.writeFileSync(discordPath, discord);

// Discord messages cap at 2,000 characters. Emit paste-ready chunks with enough
// headroom for clients that normalize line endings or add a small prefix.
const discordLines = discord.replace(/^# Discord announcement[^\n]*\n+/, "").trim().split("\n");
const chunks = [];
let chunk = "";
for (const line of discordLines) {
  const addition = `${chunk ? "\n" : ""}${line}`;
  if (chunk.length + addition.length > 1900) {
    chunks.push(chunk.trim());
    chunk = line;
  } else {
    chunk += addition;
  }
}
if (chunk.trim()) chunks.push(chunk.trim());
fs.writeFileSync(discordChunksPath, chunks.map((value, index) => `--- MESSAGE ${index + 1} OF ${chunks.length} ---\n${value}`).join("\n\n"));

function sql(value) { return value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`; }
function json(value) { return `${sql(JSON.stringify(value))}::jsonb`; }
const values = profiles.map((p) => `(${[
  sql(p.name), sql(p.position), sql(p.position_group), p.est_ovr, sql(p.height), p.weight ?? "null", sql(p.hand), p.jersey_number ?? "null",
  sql(p.dev_trait), sql(p.archetype), sql(p.build_note), sql(p.college), sql(p.body_type), json(p.attributes), json(p.abilities),
  sql(p.legend_tier), sql(p.store_subgroup), sql(p.photo_url), sql("madden"), sql(p.catalog_group),
].join(",")})`).join(",\n");
const migration = [
  "-- Generated by scripts/dev/build-new-storefront-catalog.mjs.",
  "-- Launch prices are configured separately in configure_expanded_legend_store_pricing_and_cap.",
  "insert into public.rec_legend_catalog (",
  "  name,position,position_group,est_ovr,height,weight,hand,jersey_number,dev_trait,archetype,build_note,college,body_type,attributes,abilities,legend_tier,store_subgroup,photo_url,game_scope,catalog_group",
  ") values",
  values,
  "on conflict (name, position) do update set",
  "  position_group=excluded.position_group,est_ovr=excluded.est_ovr,height=excluded.height,weight=excluded.weight,hand=excluded.hand,jersey_number=excluded.jersey_number,",
  "  dev_trait=excluded.dev_trait,archetype=excluded.archetype,build_note=excluded.build_note,college=excluded.college,body_type=excluded.body_type,attributes=excluded.attributes,",
  "  abilities=excluded.abilities,legend_tier=excluded.legend_tier,store_subgroup=excluded.store_subgroup,game_scope=excluded.game_scope,catalog_group=excluded.catalog_group;",
  "",
].join("\n");
fs.writeFileSync(migrationPath, migration);

console.log(JSON.stringify({ outputPath, ratingsPath, discordPath, discordChunksPath, migrationPath, discordMessages: chunks.length, counts: actual }, null, 2));
