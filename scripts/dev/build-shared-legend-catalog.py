"""Build shared legend catalog seed + curation docs from 2K8 sheet + live DB dump."""
from __future__ import annotations

import collections
import json
import re
import uuid
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs" / "legends"
DB_DUMP = DOCS / "_db_catalog.json"
XLSX = Path(r"c:\Users\josh_\Downloads\all-pro_football_2k8.xlsx")

# Curated Immortal silvers (HOF / iconic). Remaining silvers → Legend.
IMMORTAL_SILVERS = {
    "Randall Cunningham", "Len Dawson", "Ken Stabler", "Bart Starr", "Joe Theismann",
    "Chris Doleman", "Jack Youngblood", "Elvin Bethea", 'Ed "Too Tall" Jones',
    "Mel Renfro", "Lem Barney", "Lester Hayes",
    "Chuck Bednarik", "Harry Carson", "Greg Lloyd",
    "Dan Hampton", "Keith Millard",
    "Roger Craig", "Hugh McElhenny", "Lenny Moore", "Ricky Watters", "Ottis Anderson",
    "Jan Stenerud",
    "Joe DeLamielleure", "Tom Mack", "Randall McDaniel",
    "Ron Yary", "Mike Munchak", "Rayfield Wright",
    "Todd Christensen", "Keith Jackson",
    "Andre Reed", "Don Maynard", "Drew Pearson", "Herman Moore", "Charley Taylor", "Irving Fryar",
    "Jack Tatum", "Leroy Butler", "Deron Cherry",
}

# Catalog-only Immortals (not on 2K8). Rest of catalog-only → Legend.
IMMORTAL_CATALOG_ONLY = {
    "Tom Brady", "Peyton Manning", "Michael Vick", "Ben Roethlisberger", "Warren Moon",
    "Jim Brown", "Adrian Peterson", "LaDainian Tomlinson", "Marshall Faulk", "Eric Dickerson",
    "Tony Dorsett", "Bo Jackson", "Herschel Walker",
    "Randy Moss", "Calvin Johnson", "Cris Carter", "Larry Fitzgerald", "Michael Irvin",
    "Steve Largent", "Terrell Owens", "Andre Johnson", "Devin Hester",
    "Tony Gonzalez", "Rob Gronkowski", "Antonio Gates", "Jason Witten",
    "Larry Allen", "Jonathan Ogden", "Orlando Pace", "Mike Webster", "Forrest Gregg", "John Hannah", "Joe Thomas",
    "Bruce Smith", "Mean Joe Greene", "Alan Page", "Aaron Donald", "Ndamukong Suh", "Julius Peppers",
    "Lawrence Taylor", "Ray Lewis", "Ted Hendricks", "Jack Ham", "Luke Kuechly", "Patrick Willis", "Von Miller",
    "Deion Sanders", "Champ Bailey", "Charles Woodson", "Darrelle Revis", "Ed Reed", "Troy Polamalu",
    "Sean Taylor", "Paul Krause", "Steve Atwater", "Brian Dawkins",
    "Mike Alstott", "Lorenzo Neal", "Larry Csonka", "Jim Taylor",
    "Cam Newton", "Joe Burrow", "Roger Staubach", "Earl Campbell", "Lee Roy Selmon", "Derrick Thomas",
    "Fred Biletnikoff", "John Hannah",
}

# Map 2K8 position → catalog coarse position + group
POS_MAP = {
    "QB": ("QB", "offense"), "HB": ("HB", "offense"), "FB": ("FB", "offense"),
    "WR": ("WR", "offense"), "TE": ("TE", "offense"),
    "C": ("OL", "offense"), "OG": ("OL", "offense"), "OT": ("OL", "offense"),
    "DE": ("DL", "defense"), "DT": ("DL", "defense"),
    "ILB": ("LB", "defense"), "OLB": ("LB", "defense"),
    "CB": ("DB", "defense"), "FS": ("DB", "defense"), "SS": ("DB", "defense"),
    "K": ("K", "offense"), "P": ("P", "defense"),
}

# Position-gated 2K8 → Madden ability maps. A skill only maps when valid for that coarse group.
# Wrong-group mappings (e.g. Tip Drill on OL) are intentionally omitted.

SKILL_TO_MADDEN_BY_POS: dict[str, dict[str, tuple[str, str]]] = {
    "QB": {
        "Rocket Arm": ("Gunslinger", "superstar"),
        "Rocker Arm": ("Gunslinger", "superstar"),
        "Laser Arm": ("Pass Lead Elite", "superstar"),
        "Quick Release": ("Quick Draw", "superstar"),
        "Pocket Presence": ("Pass Protector", "superstar"),
        "Scrambler": ("Scrambler", "superstar"),
        "QB Evade": ("Escape Artist", "superstar"),
        "4th Qtr": ("Comeback", "xfactor"),
        "4th Quarter Comeback": ("Comeback", "xfactor"),
        "Clutch": ("Comeback", "xfactor"),
        "Signal Steal": ("Master Tactician", "superstar"),
        "Signal Stealer": ("Master Tactician", "superstar"),
        "Leadership": ("Master Tactician", "superstar"),
        "Cadence": ("Inside Focus", "superstar"),
        "Play Fake": ("Playmaker", "superstar"),
        "Deception": ("Playmaker", "superstar"),
        "Pass Threat": ("Truzz", "xfactor"),
        "Tough as Nails": ("Brick Wall", "superstar"),
        "Speed Burner": ("Escape Artist", "superstar"),
        "Quick Feet": ("Escape Artist", "superstar"),
        "Durability": ("Brick Wall", "superstar"),
    },
    "HB": {
        "Speed Burner": ("Racetrack", "xfactor"),
        "Quick Feet": ("Juke Box", "superstar"),
        "Finesse": ("Evasive", "superstar"),
        "Power": ("Tank", "xfactor"),
        "Workhorse": ("Backfield Mismatch", "superstar"),
        "Branching Tackles": ("Balance Beam", "superstar"),
        "Branchin Tackles": ("Balance Beam", "superstar"),
        "Break Away": ("Home Run", "xfactor"),
        "Break Away Burst": ("Home Run", "xfactor"),
        "Cutback": ("Juke Box", "superstar"),
        "Cutback Ability": ("Juke Box", "superstar"),
        "Stop on a Dime": ("Human Joystick", "xfactor"),
        "Goalline": ("Goal Line Back", "superstar"),
        "Goaline": ("Goal Line Back", "superstar"),
        "Soft Hands": ("Grab-N-Go", "superstar"),
        "Secure Ball": ("Bulletproof", "superstar"),
        "Arm of Steel": ("Stiff Arm", "superstar"),
        "Battering Ram": ("Truck", "superstar"),
        "Scissors": ("Spin Cycle", "superstar"),
        "Return Spec": ("Return Man", "superstar"),
        "Return Specialist": ("Return Man", "superstar"),
        "Mr. 3rd Down": ("Route Technician", "superstar"),
        "Mr 3rd Down": ("Route Technician", "superstar"),
        "Possession Receiver": ("Possession Catch", "superstar"),
        "Possession Recevier": ("Possession Catch", "superstar"),
        "Cyclone": ("Spin Cycle", "superstar"),
        "Ankle Breaker": ("Ankle Breaker", "xfactor"),
        "Clutch": ("Backfield Mismatch", "superstar"),
        "Leadership": ("Backfield Mismatch", "superstar"),
        "Durability": ("Bulletproof", "superstar"),
        "Tough as Nails": ("Balance Beam", "superstar"),
    },
    "FB": {
        "Power": ("Tank", "xfactor"),
        "Battering Ram": ("Truck", "superstar"),
        "Bulldozer": ("Lead The Way", "superstar"),
        "Brick Wall": ("Lead The Way", "superstar"),
        "Soft Hands": ("Possession Catch", "superstar"),
        "Workhorse": ("Tank", "xfactor"),
        "Strength": ("Nasty Streak", "superstar"),
        "Durability": ("Natural Talent", "superstar"),
        "Leadership": ("Lead The Way", "superstar"),
    },
    "WR": {
        "Route God": ("Route Technician", "superstar"),
        "Deep Threat": ("Deep Out Elite", "superstar"),
        "Acrobatic Catches": ("Acrobat", "superstar"),
        "Bumper": ("RAC", "superstar"),
        "Tough in Middle": ("Mid In Elite", "superstar"),
        "Magic Feet": ("Juke Box", "superstar"),
        "Hops": ("Jump Ball", "superstar"),
        "Soft Hands": ("Possession Catch", "superstar"),
        "Secure Ball": ("Bulletproof", "superstar"),
        "Break Away": ("Home Run", "xfactor"),
        "Speed Burner": ("Racetrack", "xfactor"),
        "Quick Feet": ("Juke Box", "superstar"),
        "Ankle Breaker": ("Ankle Breaker", "xfactor"),
        "Return Spec": ("Return Man", "superstar"),
        "Return Specialist": ("Return Man", "superstar"),
        "Mr. 3rd Down": ("Route Technician", "superstar"),
        "Mr 3rd Down": ("Route Technician", "superstar"),
        "Possession": ("Possession Catch", "superstar"),
        "Possession Rec": ("Possession Catch", "superstar"),
        "Possession Receiver": ("Possession Catch", "superstar"),
        "Clutch": ("Acrobat", "superstar"),
        "Leadership": ("Route Technician", "superstar"),
        "Durability": ("Bulletproof", "superstar"),
        "Cutback": ("Juke Box", "superstar"),
    },
    "TE": {
        "Route God": ("Route Technician", "superstar"),
        "Soft Hands": ("Possession Catch", "superstar"),
        "Tough in Middle": ("Mid In Elite", "superstar"),
        "Break Away": ("YAC'Em Up", "xfactor"),
        "Bulldozer": ("Matchup Nightmare", "superstar"),
        "Speed Burner": ("Racetrack", "xfactor"),
        "Mr 3rd Down": ("Route Technician", "superstar"),
        "Mr. 3rd Down": ("Route Technician", "superstar"),
        "Possession": ("Possession Catch", "superstar"),
        "Strength": ("Matchup Nightmare", "superstar"),
        "Durability": ("Natural Talent", "superstar"),
        "Leadership": ("Matchup Nightmare", "superstar"),
        "Return Spec": ("Return Man", "superstar"),
    },
    "OL": {
        # Pass-pro / pocket
        "Stonewall": ("Secure Protector", "superstar"),
        "Brick Wall": ("All Day", "superstar"),
        "Bulldozer": ("Post Up", "superstar"),
        "Quick Feet": ("Natural Talent", "superstar"),
        "Speed Burner": ("Natural Talent", "superstar"),
        "Strength": ("Nasty Streak", "superstar"),
        "Durability": ("Natural Talent", "superstar"),
        "Stamina": ("All Day", "superstar"),
        "Leadership": ("Linchpin", "superstar"),
        "Clutch": ("Secure Protector", "superstar"),
        "Special Team Demon": ("Special Teams Ace", "superstar"),
    },
    "DL": {
        "Strength": ("Power Rush", "superstar"),
        "Speed Burner": ("Edge Threat", "superstar"),
        "Quick Feet": ("Rip Artist", "superstar"),
        "Bulldozer": ("Run Stopper", "superstar"),
        "Brick Wall": ("Run Stopper", "superstar"),
        "Stonewall": ("Run Stopper", "superstar"),
        "Durability": ("Relentless", "superstar"),
        "Leadership": ("Run Stopper", "superstar"),
        "Power": ("Unstoppable Force", "xfactor"),
    },
    "LB": {
        "Leadership": ("Lurker", "xfactor"),
        "Strength": ("Out My Way", "superstar"),
        "Speed Burner": ("Lurker", "xfactor"),
        "Quick Feet": ("Mid Zone KO", "superstar"),
        "Durability": ("Relentless", "superstar"),
        "Clutch": ("Pick Artist", "superstar"),
        "Ball Hawk": ("Pick Artist", "superstar"),
    },
    "DB": {
        "Leadership": ("Shutdown", "xfactor"),
        "Speed Burner": ("Shutdown", "xfactor"),
        "Quick Feet": ("Man to Man", "superstar"),
        "Durability": ("Relentless", "superstar"),
        "Clutch": ("Pick Artist", "superstar"),
        "Ball Hawk": ("Pick Artist", "superstar"),
        "Return Spec": ("Return Man", "superstar"),
        "Return Specialist": ("Return Man", "superstar"),
        "Hops": ("Jump Ball", "superstar"),
    },
    "K": {
        "Clutch": ("Ice the Kicker", "xfactor"),
        "Kick Accuracy": ("Accurate", "superstar"),
        "Kick Power": ("Power Kick", "superstar"),
        "Leadership": ("Accurate", "superstar"),
    },
    "P": {
        "Kick Accuracy": ("Coffin Corner", "superstar"),
        "Kick Power": ("Boomer", "superstar"),
        "Clutch": ("Coffin Corner", "superstar"),
    },
}

POS_DEFAULT_XF = {
    "QB": ("Truzz", "X-Factor: elite timing window and accuracy under duress."),
    "HB": ("Ankle Breaker", "X-Factor: elite elusiveness after the first miss."),
    "FB": ("Wrecking Ball", "X-Factor: violent short-yardage runner/blocker."),
    "WR": ("Racetrack", "X-Factor: burner vertical threat."),
    "TE": ("YAC'Em Up", "X-Factor: yards-after-catch mismatch."),
    "OL": ("Virtuoso", "X-Factor: dominant pass-pro identity for elite tackles/guards/centers."),
    "DL": ("Unstoppable Force", "X-Factor: unblockable get-off."),
    "LB": ("Lurker", "X-Factor: instinctive playmaker."),
    "DB": ("Shutdown", "X-Factor: blanketed coverage."),
    "K": ("Ice the Kicker", "X-Factor: clutch kicks."),
    "P": ("Coffin Corner", "X-Factor: specialty placement."),
}

POS_DEFAULT_SS = {
    "QB": [("Gunslinger", "Superstar: aggressive deep-ball timing."), ("Pass Lead Elite", "Superstar: lead throws."), ("Escape Artist", "Superstar: pocket movement.")],
    "HB": [("Balance Beam", "Superstar: contact balance."), ("Juke Box", "Superstar: elusiveness."), ("Bulletproof", "Superstar: secure ball.")],
    "FB": [("Lead The Way", "Superstar: lead blocking."), ("Tank", "Superstar: power."), ("Natural Talent", "Superstar: block resistance.")],
    "WR": [("Route Technician", "Superstar: route nuance."), ("Acrobat", "Superstar: contested catches."), ("Possession Catch", "Superstar: reliable hands.")],
    "TE": [("Matchup Nightmare", "Superstar: TE mismatch."), ("Possession Catch", "Superstar: reliable hands."), ("Route Technician", "Superstar: routes.")],
    "OL": [("Secure Protector", "Superstar: resists quick sheds in pass pro."), ("All Day", "Superstar: sustains blocks vs pass rush."), ("Post Up", "Superstar: wins double-teams / drive blocks."), ("Linchpin", "Superstar: elevates the entire OL (center identity)."), ("Natural Talent", "Superstar: built-in block resistance."), ("Nasty Streak", "Superstar: finishing power as a run blocker.")],
    "DL": [("Rip Artist", "Superstar: pass rush."), ("Run Stopper", "Superstar: run defense."), ("Edge Threat", "Superstar: edge get-off.")],
    "LB": [("Out My Way", "Superstar: shedding."), ("Pick Artist", "Superstar: ball skills."), ("Mid Zone KO", "Superstar: zone coverage.")],
    "DB": [("Man to Man", "Superstar: man coverage."), ("Pick Artist", "Superstar: ball skills."), ("Zone KO", "Superstar: zone.")],
    "K": [("Accurate", "Superstar: accuracy."), ("Power Kick", "Superstar: range.")],
    "P": [("Directional", "Superstar: placement."), ("Boomer", "Superstar: hangtime/distance.")],
}

# Fine position codes (C/LT/CB/…) → coarse group used for ability maps.
FINE_TO_COARSE = {
    "LT": "OL", "LG": "OL", "C": "OL", "RG": "OL", "RT": "OL", "OL": "OL",
    "LE": "DL", "RE": "DL", "DT": "DL", "DL": "DL",
    "MLB": "LB", "LOLB": "LB", "ROLB": "LB", "ILB": "LB", "OLB": "LB", "LB": "LB",
    "CB": "DB", "FS": "DB", "SS": "DB", "DB": "DB",
    "QB": "QB", "HB": "HB", "FB": "FB", "WR": "WR", "TE": "TE", "K": "K", "P": "P",
}


def coarse_for_position(pos: str) -> str:
    return FINE_TO_COARSE.get(pos, pos if pos in POS_DEFAULT_SS else "DB")

BASE_ATTRS = {
    "Speed": 80, "Acceleration": 82, "Agility": 80, "Strength": 78, "Awareness": 88,
    "Carrying": 70, "BC Vision": 70, "Break Tackle": 70, "Trucking": 65, "Stiff Arm": 65,
    "Change of Direction": 78, "Spin Move": 65, "Juke Move": 68, "Catching": 60,
    "Catch in Traffic": 55, "Spectacular Catch": 55, "Short Route Running": 50,
    "Medium Route Running": 45, "Deep Route Running": 40, "Release": 45, "Jumping": 80,
    "Throwing Power": 40, "Short Accuracy": 30, "Medium Accuracy": 25, "Deep Accuracy": 20,
    "Throw on the Run": 25, "Throw Under Pressure": 25, "Break Sack": 40, "Play Action": 30,
    "Pass Blocking": 40, "Pass Block Power": 38, "Pass Block Finesse": 36, "Run Blocking": 40,
    "Run Block Power": 38, "Run Block Finesse": 36, "Lead Block": 35, "Impact Blocking": 40,
    "Play Recognition": 70, "Tackling": 55, "Hit Power": 55, "Block Shedding": 50,
    "Finesse Moves": 40, "Power Moves": 40, "Pursuit": 70, "Man Coverage": 40,
    "Zone Coverage": 45, "Press": 35, "Kick/Punt Return": 20, "Kicking Power": 25,
    "Kicking Accuracy": 20, "Stamina": 90, "Toughness": 90, "Injury": 90, "Long Snap": 40,
}

POS_BOOSTS = {
    "QB": {"Throwing Power": 92, "Short Accuracy": 90, "Medium Accuracy": 90, "Deep Accuracy": 88, "Throw Under Pressure": 88, "Awareness": 92, "Play Action": 88, "Break Sack": 75, "Speed": 72},
    "HB": {"Speed": 91, "Acceleration": 92, "Agility": 90, "Carrying": 92, "BC Vision": 93, "Break Tackle": 88, "Change of Direction": 90, "Juke Move": 88, "Trucking": 80},
    "FB": {"Strength": 92, "Run Blocking": 92, "Lead Block": 94, "Impact Blocking": 92, "Trucking": 88, "Break Tackle": 86, "Carrying": 82},
    "WR": {"Speed": 91, "Acceleration": 92, "Catching": 94, "Catch in Traffic": 90, "Spectacular Catch": 90, "Release": 90, "Short Route Running": 90, "Medium Route Running": 90, "Deep Route Running": 88, "Jumping": 90},
    "TE": {"Catching": 92, "Catch in Traffic": 92, "Short Route Running": 88, "Medium Route Running": 88, "Run Blocking": 82, "Pass Blocking": 78, "Strength": 86, "Jumping": 88},
    "OL": {"Strength": 94, "Pass Blocking": 94, "Pass Block Power": 93, "Pass Block Finesse": 92, "Run Blocking": 94, "Run Block Power": 94, "Impact Blocking": 93, "Awareness": 92, "Speed": 65},
    "DL": {"Strength": 94, "Block Shedding": 92, "Power Moves": 90, "Finesse Moves": 88, "Pursuit": 90, "Tackling": 90, "Hit Power": 88, "Play Recognition": 90},
    "LB": {"Awareness": 94, "Play Recognition": 94, "Tackling": 93, "Pursuit": 93, "Hit Power": 90, "Block Shedding": 88, "Speed": 86, "Zone Coverage": 82},
    "DB": {"Speed": 92, "Acceleration": 92, "Man Coverage": 90, "Zone Coverage": 90, "Play Recognition": 92, "Press": 86, "Catching": 82, "Pursuit": 88, "Tackling": 82},
    "K": {"Kicking Power": 94, "Kicking Accuracy": 92, "Awareness": 85},
    "P": {"Kicking Power": 92, "Kicking Accuracy": 90, "Awareness": 84},
}


def normalize(name: str) -> str:
    n = name.lower().strip().replace("’", "'").replace("‘", "'").replace("ñ", "n")
    n = re.sub(r'\s*"[^"]+"\s*', " ", n)
    n = re.sub(r"\s+", " ", n).replace(".", "").strip()
    if n == "warrren moon":
        n = "warren moon"
    return n


def first_last(name: str) -> str:
    parts = normalize(name).split()
    return f"{parts[0]} {parts[-1]}" if len(parts) >= 2 else normalize(name)


def parse_sheet():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    players = []
    for row in wb["All-Pro Football 2K8"].iter_rows(min_row=2, values_only=True):
        if not row or not row[1]:
            continue
        name = str(row[1]).strip()
        if normalize(name) == "warren moon" or name.lower().startswith("warrren"):
            name = "Warren Moon"
        players.append({
            "pos_2k8": str(row[0]).strip(),
            "name": name,
            "class": str(row[2]).strip(),
            "abilities_2k8": str(row[3] or "").strip(),
        })
    return players


def load_db_rows():
    return json.loads(DB_DUMP.read_text(encoding="utf-8"))


def pick_db_row(rows_by_key: dict[str, list], name: str):
    key = normalize(name)
    cands = rows_by_key.get(key, [])
    if not cands:
        fl = first_last(name)
        for k, rows in rows_by_key.items():
            if first_last(rows[0]["name"]) == fl or (
                k.split()[-1] == key.split()[-1] and key.split()[0] in k
            ):
                cands = rows
                break
    if not cands:
        return None
    madden = [r for r in cands if r.get("game_scope") == "madden"]
    chosen = madden[0] if madden else cands[0]
    college = next((r.get("college") for r in cands if r.get("college")), chosen.get("college"))
    return {**chosen, "college": college}


def build_attrs(coarse_pos: str, tier: str, existing: dict | None):
    if existing and len(existing) > 10:
        attrs = dict(existing)
    else:
        attrs = dict(BASE_ATTRS)
        attrs.update(POS_BOOSTS.get(coarse_pos, {}))
    # Tier ceiling nudge
    bump = 2 if tier == "immortal" else 0
    for k, v in list(attrs.items()):
        if isinstance(v, (int, float)):
            attrs[k] = int(min(99, max(15, round(float(v) + bump))))
    return attrs


def map_abilities(abilities_2k8: str, coarse_pos: str, tier: str) -> list[dict]:
    """Map 2K8 skills → Madden abilities using only the coarse position's skill table."""
    coarse = coarse_for_position(coarse_pos)
    skill_map = SKILL_TO_MADDEN_BY_POS.get(coarse, {})
    out: list[dict] = []
    seen: set[str] = set()
    parts = [p.strip() for p in re.split(r"[,;]", abilities_2k8 or "") if p.strip() and p.strip() != "?"]
    for skill in parts:
        mapped = skill_map.get(skill)
        if not mapped:
            skill_l = skill.lower()
            for k, v in skill_map.items():
                kl = k.lower()
                if kl in skill_l or skill_l in kl:
                    mapped = v
                    break
        if not mapped:
            continue
        name, typ = mapped
        if tier == "legend" and typ == "xfactor":
            typ = "superstar"
        if name in seen:
            continue
        seen.add(name)
        out.append({"name": name, "description": f"Mapped from 2K8 skill '{skill}'.", "type": typ})

    defaults_ss = POS_DEFAULT_SS.get(coarse, [])
    if tier == "immortal":
        xf_name, xf_desc = POS_DEFAULT_XF.get(coarse, ("Franchise", "X-Factor identity."))
        if not any(a["type"] == "xfactor" for a in out):
            out.insert(0, {"name": xf_name, "description": xf_desc, "type": "xfactor"})
            seen.add(xf_name)
        for name, desc in defaults_ss:
            if name not in seen:
                out.append({"name": name, "description": desc, "type": "superstar"})
                seen.add(name)
            if sum(1 for a in out if a["type"] == "superstar") >= 3:
                break
        xfs = [a for a in out if a["type"] == "xfactor"]
        sss = [a for a in out if a["type"] == "superstar"]
        out = xfs[:1] + sss[:3]
    else:
        out = [a for a in out if a["type"] != "xfactor"]
        if not out:
            for name, desc in defaults_ss[:3]:
                out.append({"name": name, "description": desc, "type": "superstar"})
        out = out[:3]
    return out


def est_ovr_for(tier: str, existing_ovr) -> float:
    if existing_ovr is not None:
        try:
            val = float(existing_ovr)
            if tier == "immortal":
                return round(max(val, 88.0), 1)
            return round(min(max(val, 84.0), 89.5), 1)
        except Exception:
            pass
    return 89.0 if tier == "immortal" else 86.0


def sql_escape(s: str | None) -> str:
    if s is None:
        return "null"
    return "'" + str(s).replace("'", "''") + "'"


def main():
    DOCS.mkdir(parents=True, exist_ok=True)
    sheet = parse_sheet()
    db_rows = load_db_rows()
    rows_by_key: dict[str, list] = collections.defaultdict(list)
    for r in db_rows:
        rows_by_key[normalize(r["name"])].append(r)

    sheet_keys = {normalize(p["name"]) for p in sheet}
    catalog_only_names = []
    for key, rows in rows_by_key.items():
        if key not in sheet_keys and first_last(rows[0]["name"]) not in {first_last(p["name"]) for p in sheet}:
            # also check partial
            hit = False
            for p in sheet:
                pp, cp = normalize(p["name"]).split(), key.split()
                if pp and cp and pp[-1] == cp[-1] and (pp[0] in cp or cp[0] in pp):
                    hit = True
                    break
            if not hit:
                catalog_only_names.append(rows[0]["name"])

    union: dict[str, dict] = {}

    # 2K8 players
    for p in sheet:
        coarse, group = POS_MAP[p["pos_2k8"]]
        if p["class"] == "Gold":
            tier = "immortal"
        elif p["class"] == "Bronze":
            tier = "legend"
        else:
            tier = "immortal" if p["name"] in IMMORTAL_SILVERS else "legend"
        db = pick_db_row(rows_by_key, p["name"])
        key = normalize(p["name"])
        attrs = build_attrs(coarse, tier, db.get("attributes") if db else None)
        abilities = map_abilities(p["abilities_2k8"], coarse, tier)
        union[key] = {
            "name": p["name"],
            "position": db["position"] if db and db.get("game_scope") == "madden" else coarse,
            "position_group": group,
            "legend_tier": tier,
            "dev_trait": "xfactor" if tier == "immortal" else "superstar",
            "est_ovr": est_ovr_for(tier, db.get("est_ovr") if db else None),
            "height": db.get("height") if db else None,
            "weight": db.get("weight") if db else None,
            "hand": db.get("hand") if db else "Right",
            "jersey_number": db.get("jersey_number") if db else None,
            "archetype": db.get("archetype") if db else f"{p['pos_2k8']} legend",
            "build_note": (db.get("build_note") if db else None) or f"2K8 {p['class']} — {p['abilities_2k8'] or 'archetypal build'}.",
            "college": db.get("college") if db else None,
            "body_type": db.get("body_type") if db else None,
            "photo_url": db.get("photo_url") if db else None,
            "attributes": attrs,
            "abilities": abilities,
            "source_2k8_class": p["class"],
            "source_2k8_pos": p["pos_2k8"],
            "abilities_2k8": p["abilities_2k8"],
        }

    # catalog-only
    for name in catalog_only_names:
        db = pick_db_row(rows_by_key, name)
        if not db:
            continue
        key = normalize(name)
        if key in union:
            continue
        tier = "immortal" if name in IMMORTAL_CATALOG_ONLY else "legend"
        # normalize position group from db
        pos = db["position"]
        group = "offense" if pos in {"QB", "HB", "FB", "WR", "TE", "OL", "LT", "LG", "C", "RG", "RT", "K"} or pos.endswith("T") and pos in {"LT", "RT"} else "defense"
        if pos in {"LT", "LG", "C", "RG", "RT"}:
            coarse = "OL"
            pos_out = pos  # keep specific OL spots from CFB/madden finer codes when present
        elif pos in {"LE", "RE", "DT"}:
            coarse = "DL"
            pos_out = pos
        elif pos in {"MLB", "LOLB", "ROLB"}:
            coarse = "LB"
            pos_out = pos
        elif pos in {"CB", "FS", "SS"}:
            coarse = "DB"
            pos_out = pos
        else:
            coarse = pos if pos in POS_BOOSTS else "DB"
            pos_out = pos
        if pos_out in {"LT", "LG", "C", "RG", "RT"}:
            group = "offense"
        attrs = build_attrs(coarse if coarse in POS_BOOSTS else pos_out, tier, db.get("attributes"))
        abilities = map_abilities("", coarse if coarse in POS_DEFAULT_SS else "DB", tier)
        union[key] = {
            "name": db["name"],
            "position": pos_out,
            "position_group": db.get("position_group") or group,
            "legend_tier": tier,
            "dev_trait": "xfactor" if tier == "immortal" else "superstar",
            "est_ovr": est_ovr_for(tier, db.get("est_ovr")),
            "height": db.get("height"),
            "weight": db.get("weight"),
            "hand": db.get("hand") or "Right",
            "jersey_number": db.get("jersey_number"),
            "archetype": db.get("archetype"),
            "build_note": db.get("build_note") or "Shared catalog legend.",
            "college": db.get("college"),
            "body_type": db.get("body_type"),
            "photo_url": db.get("photo_url"),
            "attributes": attrs,
            "abilities": abilities,
            "source_2k8_class": None,
            "source_2k8_pos": None,
            "abilities_2k8": None,
        }

    players = sorted(union.values(), key=lambda p: (p["legend_tier"], p["position"], p["name"]))
    (DOCS / "shared-catalog-seed.json").write_text(json.dumps(players, indent=2), encoding="utf-8")

    # Immortal picks applied doc
    immortal = [p for p in players if p["legend_tier"] == "immortal"]
    legend = [p for p in players if p["legend_tier"] == "legend"]
    lines = [
        "# Immortal picks (applied defaults)",
        "",
        "Silvers + catalog-only Immortals were curated so implementation can proceed. Edit this list and re-run `scripts/dev/build-shared-legend-catalog.py` to adjust.",
        "",
        f"- Immortals: **{len(immortal)}**",
        f"- Legends: **{len(legend)}**",
        f"- Total shared catalog: **{len(players)}**",
        "",
        "## Immortal silvers",
        "",
    ]
    for n in sorted(IMMORTAL_SILVERS):
        lines.append(f"- [x] {n}")
    lines += ["", "## Immortal catalog-only", ""]
    for n in sorted(IMMORTAL_CATALOG_ONLY):
        lines.append(f"- [x] {n}")
    lines += ["", "## All Immortals", ""]
    for p in sorted(immortal, key=lambda x: (x["position"], x["name"])):
        lines.append(f"- **{p['name']}** ({p['position']}) · OVR {p['est_ovr']} · XF")
    (DOCS / "immortal-picks-applied.md").write_text("\n".join(lines), encoding="utf-8")

    # Abilities proposals
    alines = ["# Madden ability proposals", "", "Immortal = 1 X-Factor + up to 3 Superstar. Legend = up to 3 Superstar.", ""]
    for p in players:
        alines.append(f"## {p['name']} ({p['legend_tier']} · {p['position']} · {p['dev_trait']})")
        if p.get("abilities_2k8"):
            alines.append(f"- 2K8: {p['abilities_2k8']}")
        for a in p["abilities"]:
            alines.append(f"- [{a['type']}] **{a['name']}** — {a['description']}")
        alines.append("")
    (DOCS / "abilities-proposals.md").write_text("\n".join(alines), encoding="utf-8")

    # Ratings summary
    rlines = ["# Ratings / bio pack summary", "", f"Players: {len(players)}", ""]
    for p in players:
        rlines.append(
            f"- **{p['name']}** · {p['legend_tier']} · {p['position']} · OVR {p['est_ovr']} · "
            f"{p.get('height') or '?'} / {p.get('weight') or '?'} · {p.get('college') or 'college TBD'}"
        )
    (DOCS / "ratings-bios-summary.md").write_text("\n".join(rlines), encoding="utf-8")

    # Mark checkboxes in silver/catalog review docs for applied picks
    def check_file(path: Path, names: set[str]):
        if not path.exists():
            return
        text = path.read_text(encoding="utf-8")
        for n in names:
            text = text.replace(f"- [ ] **{n}**", f"- [x] **{n}**")
        path.write_text(text, encoding="utf-8")

    check_file(DOCS / "silvers-for-immortal-review.md", IMMORTAL_SILVERS)
    check_file(DOCS / "catalog-only-for-immortal-review.md", IMMORTAL_CATALOG_ONLY)

    print(f"wrote {len(players)} players ({len(immortal)} immortal / {len(legend)} legend)")


if __name__ == "__main__":
    main()
