#!/usr/bin/env python3
"""Build Madden 27 ability assignment gates for Rise to Immortality.

REC assigns the ability identity only. Madden still owns Bronze/Silver/Gold from
in-game ratings. Assignment uses franchise position + archetype + OVR floors from
Madden Tools (M26-labeled pages, used for M27) with Madden School M27 overlays
and launch-roster observed OVR mins as fallback.
"""
from __future__ import annotations

import csv
import json
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
CSV_PATH = ROOT / "apps/api/scripts/data/madden27/madden27_ea_players.csv"
CATALOG_PATH = ROOT / "apps/api/scripts/data/madden27/madden27_ea_abilities_catalog.json"
TOOLS_PATH = Path(__file__).with_name("madden_tools_ability_gates.json")
OUT_PATH = Path(__file__).with_name("abilities_m27.json")

RTI_POS = {"QB", "HB", "WR", "TE", "CB", "FS", "SS", "MIKE"}
POS_ALIAS = {"WILL": "MIKE", "SAM": "MIKE", "MLB": "MIKE", "LB": "MIKE"}

# Tools name (or EA label) aliases onto the EA ratings catalog entry.
NAME_ALIASES = {
    "Extender": ["Anchored Extender", "Agile Extender"],
}

# Madden School M27 Bronze assignment rows fetched 2026-08-28.
SCHOOL_GATES = {
    "Inside Shade": [
        {"position": "CB", "maddenArchetype": "Man to Man", "ovrMin": 85},
    ],
    "Lurker": [
        {"position": "MIKE", "maddenArchetype": "Pass Coverage", "ovrMin": 90},
        {"position": "CB", "maddenArchetype": None, "ovrMin": 85},
        {"position": "FS", "maddenArchetype": "Run Support", "ovrMin": 85},
        {"position": "SS", "maddenArchetype": "Run Support", "ovrMin": 85},
    ],
}

CODE_TO_COL = {
    "SPD": "speed", "ACC": "acceleration", "AGI": "agility", "COD": "change_of_direction",
    "STR": "strength", "JMP": "jumping", "STA": "stamina", "INJ": "injury", "AWR": "awareness",
    "TOU": "toughness", "THP": "throw_power", "SAC": "throw_accuracy_short",
    "MAC": "throw_accuracy_mid", "DAC": "throw_accuracy_deep", "RUN": "throw_on_the_run",
    "TUP": "throw_under_pressure", "BSK": "break_sack", "PAC": "play_action",
    "TRK": "trucking", "BCV": "bc_vision", "SFA": "stiff_arm", "SPM": "spin_move",
    "JKM": "juke_move", "CAR": "carrying", "BTK": "break_tackle", "CTH": "catching",
    "CIT": "catch_in_traffic", "SPC": "spectacular_catch", "RLS": "release",
    "SRR": "route_running_short", "MRR": "route_running_medium", "DRR": "route_running_deep",
    "RET": "kick_return", "PBK": "pass_block", "PBP": "pass_block_power",
    "PBF": "pass_block_finesse", "RBK": "run_block", "RBP": "run_block_power",
    "RBF": "run_block_finesse", "LBK": "lead_block", "IBL": "impact_blocking",
    "TAK": "tackle", "POW": "hit_power", "PMV": "power_moves", "FMV": "finesse_moves",
    "BSH": "block_shedding", "PUR": "pursuit", "PRC": "play_recognition", "MCV": "man_coverage",
    "ZCV": "zone_coverage", "PRS": "press", "KPW": "kick_power", "KAC": "kick_accuracy",
}

# Ratings Madden uses to upgrade Bronze→Silver→Gold. Informational only.
PRIMARY: dict[str, dict] = {
    "3rd Down Threat": {"primary": "CTH", "secondary": "CIT"},
    "Acrobat": {"primary": "JMP", "secondary": "SPC"},
    "Adrenaline Rush": {"primary": "ACC", "secondary": "FMV"},
    "All Day": {"primary": "PBK", "secondary": "STA"},
    "Arm Bar": {"primary": "SFA", "secondary": "STR"},
    "B.O.G.O.": {"primary": "PMV", "secondary": "FMV"},
    "Backfield Mismatch": {"primary": "CTH", "secondary": "COD"},
    "Backlash": {"primary": "BTK", "secondary": "TRK"},
    "Bench Press": {"primary": "PRS", "secondary": "STR"},
    "Bruiser": {"primary": "TRK", "secondary": "SFA"},
    "Clutch": {"primary": "AWR", "secondary": "CAR"},
    "Dashing Deadeye": {"primary": "RUN", "secondary": "SAC"},
    "Deep Elite": {"primary": "DRR", "secondary": "SPC"},
    "Deep In Elite": {"primary": "DRR", "secondary": "CIT"},
    "Deep In Zone KO": {"primary": "ZCV", "secondary": "PRC"},
    "Deep Out Elite": {"primary": "DRR", "secondary": "SPC"},
    "Deep Out Zone KO": {"primary": "ZCV", "secondary": "SPD"},
    "Deep Route KO": {"primary": "MCV", "secondary": "SPD"},
    "Deflator": {"primary": "TAK", "secondary": "POW"},
    "Demoralizer": {"primary": "POW", "secondary": "TAK"},
    "Edge Protector": {"primary": "PBK", "secondary": "PBF"},
    "Edge Threat": {"primary": "FMV", "secondary": "SPD"},
    "El Toro": {"primary": "PMV", "secondary": "STR"},
    "Energizer": {"primary": "STA", "secondary": "ACC"},
    "Enforcer": {"primary": "POW", "secondary": "TAK"},
    "Evasive": {"primary": "COD", "secondary": "JKM"},
    "Extender": {"primary": "BSK", "secondary": "SPD"},
    "Extra Credit": {"primary": "BSH", "secondary": "PMV"},
    "Fastbreak": {"primary": "SPD", "secondary": "ACC"},
    "Fearless": {"primary": "TUP", "secondary": "TOU"},
    "Flat Zone KO": {"primary": "ZCV", "secondary": "ACC"},
    "Gift-Wrapped": {"primary": "SAC", "secondary": "AWR"},
    "Goal Line Stuff": {"primary": "BSH", "secondary": "STR"},
    "Gunslinger": {"primary": "THP", "secondary": "SAC"},
    "High Point Deadeye": {"primary": "DAC", "secondary": "THP"},
    "Human Joystick": {"primary": "COD", "secondary": "ACC"},
    "Inside Deadeye": {"primary": "MAC", "secondary": "SAC"},
    "Inside Shade": {"primary": "MCV", "secondary": "PRC"},
    "Inside Stuff": {"primary": "BSH", "secondary": "STR"},
    "Instant Rebate": {"primary": "FMV", "secondary": "PMV"},
    "Interior Threat": {"primary": "PMV", "secondary": "STR"},
    "Ironman": {"primary": "AWR", "secondary": "STA"},
    "Juke Box": {"primary": "JKM", "secondary": "COD"},
    "Linchpin": {"primary": "AWR", "secondary": "PBK"},
    "Lofting Deadeye": {"primary": "DAC", "secondary": "THP"},
    "Long Range Deadeye": {"primary": "DAC", "secondary": "THP"},
    "Lumberjack": {"primary": "POW", "secondary": "TAK"},
    "Lurker": {"primary": "PRC", "secondary": "ZCV"},
    "Matchup Nightmare": {"primary": "CTH", "secondary": "COD"},
    "Max Effort": {"primary": "STA", "secondary": "ACC"},
    "Medium Route KO": {"primary": "MCV", "secondary": "PRC"},
    "Mid In Elite": {"primary": "MRR", "secondary": "CTH"},
    "Mid Out Elite": {"primary": "MRR", "secondary": "COD"},
    "Mid Zone KO": {"primary": "ZCV", "secondary": "PRC"},
    "Mr. Big Stop": {"primary": "BSH", "secondary": "TAK"},
    "Nasty Streak": {"primary": "RBK", "secondary": "IBL"},
    "No Outsiders": {"primary": "PUR", "secondary": "SPD"},
    "No-Look Deadeye": {"primary": "SAC", "secondary": "AWR"},
    "On The Ball": {"primary": "CTH", "secondary": "MCV"},
    "One Step Ahead": {"primary": "MCV", "secondary": "PRC"},
    "Out My Way": {"primary": "BSH", "secondary": "POW"},
    "Outmatched": {"primary": "MCV", "secondary": "STR"},
    "Outside Shade": {"primary": "MCV", "secondary": "SPD"},
    "Pass Protector": {"primary": "PBK", "secondary": "PBF"},
    "Pocket Deadeye": {"primary": "SAC", "secondary": "MAC"},
    "Post Up": {"primary": "IBL", "secondary": "STR"},
    "Puller Elite": {"primary": "LBK", "secondary": "AGI"},
    "Quick Jump": {"primary": "JMP", "secondary": "ACC"},
    "Reach For It": {"primary": "CTH", "secondary": "BTK"},
    "Recuperation": {"primary": "STA", "secondary": "INJ"},
    "Red Zone Deadeye": {"primary": "SAC", "secondary": "MAC"},
    "Red Zone Threat": {"primary": "CIT", "secondary": "JMP"},
    "Roaming Deadeye": {"primary": "RUN", "secondary": "MAC"},
    "Route Technician": {"primary": "SRR", "secondary": "MRR"},
    "Run Protector": {"primary": "RBK", "secondary": "IBL"},
    "Run Stopper": {"primary": "BSH", "secondary": "TAK"},
    "Runoff Elite": {"primary": "RLS", "secondary": "ACC"},
    "Screen Protector": {"primary": "PBK", "secondary": "AWR"},
    "Secure Protector": {"primary": "PBK", "secondary": "PBP"},
    "Secure Tackler": {"primary": "TAK", "secondary": "PUR"},
    "Short In Elite": {"primary": "SRR", "secondary": "CTH"},
    "Short Out Elite": {"primary": "SRR", "secondary": "CIT"},
    "Short Route KO": {"primary": "MCV", "secondary": "ACC"},
    "Sideline Deadeye": {"primary": "SAC", "secondary": "DAC"},
    "Slot-O-Matic": {"primary": "SRR", "secondary": "COD"},
    "Steamroller": {"primary": "TRK", "secondary": "SPD"},
    "Swim Club": {"primary": "FMV", "secondary": "ACC"},
    "Tank": {"primary": "TRK", "secondary": "STR"},
    "Threat Detector": {"primary": "AWR", "secondary": "PBK"},
    "Tough Nut": {"primary": "TOU", "secondary": "PBK"},
    "Under Pressure": {"primary": "BSH", "secondary": "PMV"},
    "Unpredictable": {"primary": "FMV", "secondary": "PMV"},
    "Zen Kicker": {"primary": "KAC", "secondary": "KPW"},
    "Ankle Breaker": {"primary": "JKM", "secondary": "COD"},
    "Bazooka": {"primary": "THP", "secondary": "DAC"},
    "Bottleneck": {"primary": "PRS", "secondary": "MCV"},
    "Brick Wall": {"primary": "TRK", "secondary": "TOU"},
    "Dots": {"primary": "SAC", "secondary": "MAC"},
    "Double Me": {"primary": "CTH", "secondary": "SPC"},
    "Dual Threat": {"primary": "FMV", "secondary": "BSH"},
    "Fearmonger": {"primary": "PMV", "secondary": "BSH"},
    "First One Free": {"primary": "JKM", "secondary": "ACC"},
    "Freight Train": {"primary": "TRK", "secondary": "BTK"},
    "Momentum Shift": {"primary": "POW", "secondary": "PMV"},
    "Phenom": {"primary": "COD", "secondary": "SPD"},
    "Pro Reads": {"primary": "AWR", "secondary": "PAC"},
    "Reinforcement": {"primary": "POW", "secondary": "PRC"},
    "Relentless": {"primary": "STA", "secondary": "FMV"},
    "Run & Gun": {"primary": "RUN", "secondary": "SPD"},
    "Shutdown": {"primary": "MCV", "secondary": "ZCV"},
    "Truzz": {"primary": "CAR", "secondary": "BTK"},
    "Universal Coverage": {"primary": "MCV", "secondary": "ZCV"},
    "Unstoppable Force": {"primary": "FMV", "secondary": "PMV"},
    "YAC 'Em Up": {"primary": "BTK", "secondary": "COD"},
}


def norm_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def rti_position(raw: str | None) -> str | None:
    if not raw:
        return None
    mapped = POS_ALIAS.get(raw, raw)
    return mapped if mapped in RTI_POS else None


def map_archetypes(position: str, madden: str | None) -> list[str]:
    if not madden or madden.strip().upper() in {"ANY", "OVERALL"}:
        return ["any"]
    name = madden.strip()
    table = {
        "QB": {
            "Field General": ["Field General"],
            "Strong Arm": ["Strong Arm"],
            "Scrambler": ["Scrambler"],
            "Improviser": ["Improviser"],
            "West Coast": ["Field General"],
        },
        "HB": {
            "Elusive Back": ["Elusive"],
            "Power Back": ["Power"],
            "Receiving Back": ["All-Purpose"],
            "Elusive": ["Elusive"],
            "Power": ["Power"],
            "Receiving": ["All-Purpose"],
            "Complete": ["Complete/Vision"],
        },
        "WR": {
            "Deep Threat": ["Vertical/Deep Threat"],
            "Playmaker": ["RAC/Hybrid"],
            "Physical": ["Physical"],
            "Slot": ["Technician/Possession"],
        },
        "TE": {
            "Vertical Threat": ["Vertical/Deep Threat"],
            "Possession": ["Technician/Possession"],
            "Physical": ["Physical"],
            "Blocking": ["Physical"],
        },
        "CB": {
            "Man": ["Coverage/Shutdown"],
            "Man to Man": ["Coverage/Shutdown"],
            "Zone": ["Ball Hawk"],
            "Slot": ["Processor/Field General"],
        },
        "FS": {
            "Zone": ["Coverage/Shutdown", "Ball Hawk"],
            "Hybrid": ["Processor/Field General"],
            "Run Support": ["Physical/Run Support"],
        },
        "SS": {
            "Zone": ["Coverage/Shutdown", "Ball Hawk"],
            "Hybrid": ["Processor/Field General"],
            "Run Support": ["Physical/Run Support"],
        },
        "MIKE": {
            "Pass Coverage": ["Coverage LB", "Playmaker"],
            "Field General": ["Field General"],
            "Run Stopper": ["Run Stopper/Enforcer"],
            "Nose Tackle": ["Run Stopper/Enforcer"],
        },
    }
    mapped = table.get(position, {}).get(name)
    return mapped if mapped else ["any"]


def vals(holders, col):
    out = []
    for row in holders:
        try:
            n = float(row[col])
            if n > 0:
                out.append(n)
        except (TypeError, ValueError, KeyError):
            pass
    return out


def normalize_ovr(kind: str, raw: int | None, sibling_mins: list[int]) -> tuple[int, str]:
    if raw not in (None, 0):
        return int(raw), "madden_tools"
    if sibling_mins:
        return min(sibling_mins), "madden_tools_inherited"
    return (90 if kind == "xfactor" else 70), "madden_tools_default"


def gate_key(gate: dict) -> tuple:
    return (gate["position"], tuple(gate["archetypes"]), gate["ovrMin"])


def add_gate(gates: list[dict], gate: dict) -> None:
    key = gate_key(gate)
    existing = next((item for item in gates if gate_key(item) == key), None)
    if existing:
        if gate["source"] == "madden_school" and existing["source"] != "madden_school":
            existing["source"] = "madden_school"
            existing["maddenArchetype"] = gate.get("maddenArchetype") or existing.get("maddenArchetype")
        return
    same_pos_ovr = [
        item for item in gates
        if item["position"] == gate["position"] and item["ovrMin"] == gate["ovrMin"]
    ]
    if gate["archetypes"] == ["any"] and any(item["archetypes"] != ["any"] for item in same_pos_ovr):
        return
    if gate["archetypes"] != ["any"]:
        gates[:] = [
            item for item in gates
            if not (
                item["position"] == gate["position"]
                and item["ovrMin"] == gate["ovrMin"]
                and item["archetypes"] == ["any"]
                and item["source"] != "madden_school"
            )
        ]
    gates.append(gate)


def tools_rows_for(label: str, ea_id: str, tools_by_ea: dict, tools_by_name: dict) -> list[dict]:
    rows = []
    if ea_id in tools_by_ea:
        rows.append(tools_by_ea[ea_id])
    names = [label, *NAME_ALIASES.get(label, [])]
    for name in names:
        hit = tools_by_name.get(norm_name(name))
        if hit and hit not in rows:
            rows.append(hit)
    return rows


def gates_from_tools(kind: str, rows: list[dict]) -> list[dict]:
    criteria = []
    for row in rows:
        criteria.extend(row.get("criteria") or [])
    sibling_mins = [int(c["ovrMin"]) for c in criteria if c.get("ovrMin") not in (None, 0)]
    gates: list[dict] = []
    for c in criteria:
        pos = rti_position(c.get("position"))
        if not pos:
            continue
        ovr, source = normalize_ovr(kind, c.get("ovrMin"), sibling_mins)
        madden = c.get("archetype")
        add_gate(gates, {
            "position": pos,
            "archetypes": map_archetypes(pos, madden),
            "ovrMin": ovr,
            "maddenArchetype": madden if madden else "Any",
            "source": source,
        })
    return gates


def gates_from_school(label: str) -> list[dict]:
    gates = []
    for row in SCHOOL_GATES.get(label, []):
        pos = rti_position(row["position"])
        if not pos:
            continue
        madden = row.get("maddenArchetype")
        add_gate(gates, {
            "position": pos,
            "archetypes": map_archetypes(pos, madden),
            "ovrMin": int(row["ovrMin"]),
            "maddenArchetype": madden if madden else "Overall",
            "source": "madden_school",
        })
    return gates


def empirical_gates(kind: str, rti_positions: list[str], ovr_min: int | None) -> list[dict]:
    floor = ovr_min if ovr_min is not None else (90 if kind == "xfactor" else 75)
    floor = max(60, min(95, int(floor)))
    return [{
        "position": pos,
        "archetypes": ["any"],
        "ovrMin": floor,
        "maddenArchetype": None,
        "source": "empirical_roster",
    } for pos in rti_positions]


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text())
    tools = json.loads(TOOLS_PATH.read_text())
    tools_by_ea = {}
    tools_by_name = {}
    for row in tools["abilities"]:
        ea = str(row.get("eaId") or "")
        if ea:
            tools_by_ea[ea] = row
        if row.get("name"):
            tools_by_name[norm_name(row["name"])] = row

    with CSV_PATH.open(newline="") as f:
        rows = list(csv.DictReader(f))
    holders: dict[str, list] = defaultdict(list)
    for row in rows:
        for ability in json.loads(row["abilities_json"] or "[]"):
            holders[ability["label"]].append(row)

    abilities = []
    for item in catalog:
        label = item["label"]
        kind = "xfactor" if item["type"]["id"] == "xFactor" else "superstar"
        mapping = PRIMARY[label]
        primary = mapping["primary"]
        secondary = mapping.get("secondary")
        group = holders[label]
        primary_vals = vals(group, CODE_TO_COL[primary])
        secondary_vals = vals(group, CODE_TO_COL[secondary]) if secondary else []
        ovr_vals = vals(group, "overall")
        pos_counts = Counter(POS_ALIAS.get(r["position"], r["position"]) for r in group)
        launch_rti = [p for p, _ in pos_counts.most_common() if p in RTI_POS]

        tools_rows = tools_rows_for(label, str(item["id"]), tools_by_ea, tools_by_name)
        gates = gates_from_tools(kind, tools_rows)
        for gate in gates_from_school(label):
            add_gate(gates, gate)
        if not gates:
            gates = empirical_gates(kind, launch_rti, int(min(ovr_vals)) if ovr_vals else None)

        rti_positions = []
        for gate in gates:
            if gate["position"] not in rti_positions:
                rti_positions.append(gate["position"])
        source_set = {g["source"] for g in gates}
        if "madden_school" in source_set:
            confidence = "madden_school"
        elif any(s.startswith("madden_tools") for s in source_set):
            confidence = "madden_tools"
        else:
            confidence = "empirical_roster"

        abilities.append({
            "id": item["id"],
            "name": label,
            "description": item["description"],
            "kind": kind,
            "upgradesWith": {
                "primary": primary,
                "secondary": secondary,
            },
            "gates": gates,
            "observed": {
                "holders": len(group),
                "ovrMin": int(min(ovr_vals)) if ovr_vals else None,
                "ovrMedian": int(round(statistics.median(ovr_vals))) if ovr_vals else None,
                "primaryMin": int(min(primary_vals)) if primary_vals else None,
                "primaryMedian": int(round(statistics.median(primary_vals))) if primary_vals else None,
                "secondaryMin": int(min(secondary_vals)) if secondary_vals else None,
            },
            "launchPositions": [{"position": p, "count": c} for p, c in pos_counts.most_common()],
            "rtiPositions": rti_positions,
            "rtiEligible": bool(rti_positions),
            "confidence": confidence,
        })

    payload = {
        "_meta": {
            "version": "immortality-abilities-m27-ovr-gates-v2",
            "game": "madden_27",
            "assignmentModel": (
                "REC assigns the ability identity when the created player's position, "
                "playstyle archetype, and estimated OVR meet a franchise gate. "
                "Madden still upgrades Bronze/Silver/Gold from in-game ratings; REC does not set tier."
            ),
            "sources": [
                "EA Madden NFL 27 ratings catalog",
                "EA Madden NFL 27 launch roster (madden27_ea_players.csv)",
                "Madden Tools franchise position + archetype + OVR gates (pages still labeled Madden 26 as of 2026-08-28)",
                "Madden School Madden 27 Bronze assignment rows for Inside Shade and Lurker",
                "EA Gameplay Deep Dive: Bronze/Silver/Gold stack in Madden and are rating-driven",
            ],
            "maxEquipped": 4,
        },
        "abilities": abilities,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {len(abilities)} abilities to {OUT_PATH}")
    print("rti eligible", sum(1 for a in abilities if a["rtiEligible"]))
    print("confidence", Counter(a["confidence"] for a in abilities))
    lurker = next(a for a in abilities if a["name"] == "Lurker")
    print("lurker gates", lurker["gates"])
    bazooka = next(a for a in abilities if a["name"] == "Bazooka")
    print("bazooka gates", bazooka["gates"])
    shutdown = next(a for a in abilities if a["name"] == "Shutdown")
    print("shutdown gates", shutdown["gates"])


if __name__ == "__main__":
    main()
