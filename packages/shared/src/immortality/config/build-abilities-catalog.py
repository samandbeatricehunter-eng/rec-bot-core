#!/usr/bin/env python3
"""Build Madden 27 ability floors from the EA launch roster + curated primary ratings.

EA did not publish per-ability numeric unlock tables for Madden 27 Franchise.
This script records:
  - official catalog id/label/description/type from EA ratings
  - positions that actually have the ability on the launch roster
  - observed min/median of the curated primary rating among those holders
  - modeled Bronze/Silver/Gold floors (Madden Bronze = elite, per EA Gameplay Deep Dive)
"""
from __future__ import annotations

import csv
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
CSV_PATH = ROOT / "apps/api/scripts/data/madden27/madden27_ea_players.csv"
CATALOG_PATH = ROOT / "apps/api/scripts/data/madden27/madden27_ea_abilities_catalog.json"
OUT_PATH = Path(__file__).with_name("abilities_m27.json")

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

# Curated primary (and optional secondary) ratings from ability text + how the launch
# roster actually clusters. These are the ratings Franchise would check for tiering.
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

RTI_POS = {"QB", "HB", "WR", "TE", "CB", "FS", "SS", "MIKE"}
POS_ALIAS = {"WILL": "MIKE", "SAM": "MIKE", "MLB": "MIKE"}

# Extra logical positions for created-player eligibility even if launch roster is thin.
EXTRA_POS = {
    "Juke Box": ["QB", "HB", "WR"],
    "Acrobat": ["WR", "TE", "CB", "FS", "SS"],
    "Lurker": ["CB", "FS", "SS", "MIKE"],
    "Secure Tackler": ["SS", "MIKE", "FS"],
    "Flat Zone KO": ["CB", "FS", "SS", "MIKE"],
    "Mid Zone KO": ["FS", "SS", "MIKE"],
    "Short Route KO": ["CB", "FS", "SS", "MIKE"],
    "Medium Route KO": ["CB", "FS", "SS"],
    "Deep Route KO": ["CB", "FS"],
    "Route Technician": ["WR", "TE", "HB"],
    "Arm Bar": ["HB", "TE", "QB"],
    "Tank": ["HB", "TE"],
    "Ankle Breaker": ["HB", "WR"],
    "YAC 'Em Up": ["WR", "TE", "HB"],
    "Double Me": ["WR", "TE"],
    "Shutdown": ["CB", "FS", "SS"],
    "Universal Coverage": ["CB", "FS", "SS", "MIKE"],
    "Reinforcement": ["SS", "MIKE", "FS"],
    "Enforcer": ["SS", "MIKE"],
    "Outmatched": ["MIKE", "SS", "CB"],
}


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


def floors_for(kind: str, observed_min: int | None, n: int) -> dict:
    """Madden 27 Bronze is elite (EA Gameplay Deep Dive), not CFB's starter bronze.

    Modeled defaults: Bronze 88 / Silver 93 / Gold 96 on the primary rating.
    When the launch roster has 3+ holders, bronze is the observed primary min,
    clamped into the elite band so one outlier cannot tank the floor.
    X-Factors sit at Gold — they are the stacked end of the same tier track.
    """
    default_bronze = 88
    if observed_min is not None and n >= 3:
        bronze = max(82, min(90, observed_min))
    elif observed_min is not None:
        bronze = max(85, min(90, observed_min if observed_min >= 80 else default_bronze))
    else:
        bronze = default_bronze
    silver = min(95, bronze + 5)
    gold = min(99, max(96, bronze + 8))
    if kind == "xFactor":
        bronze = max(bronze, 90)
        silver = max(silver, 93)
        gold = max(gold, 96)
    return {"bronze": bronze, "silver": silver, "gold": gold}


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text())
    with CSV_PATH.open(newline="") as f:
        rows = list(csv.DictReader(f))
    holders: dict[str, list] = defaultdict(list)
    for row in rows:
        for ability in json.loads(row["abilities_json"] or "[]"):
            holders[ability["label"]].append(row)

    abilities = []
    for item in catalog:
        label = item["label"]
        kind = item["type"]["id"]
        mapping = PRIMARY[label]
        primary = mapping["primary"]
        secondary = mapping.get("secondary")
        col = CODE_TO_COL[primary]
        group = holders[label]
        primary_vals = vals(group, col)
        secondary_vals = vals(group, CODE_TO_COL[secondary]) if secondary else []
        ovr_vals = vals(group, "overall")
        pos_counts = Counter(POS_ALIAS.get(r["position"], r["position"]) for r in group)
        positions = [p for p, _ in pos_counts.most_common()]
        for extra in EXTRA_POS.get(label, []):
            if extra not in positions:
                positions.append(extra)
        observed_min = int(min(primary_vals)) if primary_vals else None
        observed_med = int(round(statistics.median(primary_vals))) if primary_vals else None
        floors = floors_for(kind, observed_min, len(group))
        rti_positions = [p for p in positions if p in RTI_POS]
        abilities.append({
            "id": item["id"],
            "name": label,
            "description": item["description"],
            "kind": "xfactor" if kind == "xFactor" else "superstar",
            "primary": primary,
            "secondary": secondary,
            "floors": floors,
            "observed": {
                "holders": len(group),
                "ovrMin": int(min(ovr_vals)) if ovr_vals else None,
                "ovrMedian": int(round(statistics.median(ovr_vals))) if ovr_vals else None,
                "primaryMin": observed_min,
                "primaryMedian": observed_med,
                "secondaryMin": int(min(secondary_vals)) if secondary_vals else None,
            },
            "launchPositions": [{"position": p, "count": c} for p, c in pos_counts.most_common()],
            "rtiPositions": rti_positions,
            "rtiEligible": bool(rti_positions),
            "confidence": "empirical_roster" if len(group) >= 3 else "modeled_plus_thin_roster",
        })

    payload = {
        "_meta": {
            "version": "immortality-abilities-m27-v1",
            "game": "madden_27",
            "officialNumericFloorsPublished": False,
            "sources": [
                "EA Madden NFL 27 ratings catalog (apps/api/scripts/data/madden27/madden27_ea_abilities_catalog.json)",
                "EA Madden NFL 27 launch roster (madden27_ea_players.csv, 2362 players)",
                "EA Gameplay Deep Dive: Madden abilities are Bronze/Silver/Gold and stack; Bronze is elite, not a starter tier",
                "EA Franchise Deep Dive: Franchise tiers upgrade from relevant ratings as the player progresses",
                "CFB 26 Dynasty Deep Dive analog: physical ability tiers require attribute floors (e.g. Platinum Shifty 97 COD + 96 ACC). Madden 27 uses three tiers instead of five",
                "Madden Tools / Madden School Madden 26 franchise gates (archetype + OVR 70/80/85/90) — legacy, not M27. Madden Tools still labels its pages as Madden 26 as of 2026-08-28",
                "MUT.GG MUT 26 discounted-bucket example (Short Route KO 94 MCV, Medium Route KO 96 MCV) — Ultimate Team only, not Franchise",
                "abilities.clutchtrait.com Madden 27 datamine: confirms Bronze/Silver/Gold effect stacking; does not publish rating floors",
            ],
            "tierModel": {
                "bronze": "Elite entry. Default 88 primary, or launch-roster observed min (clamped 82-90) when n>=3.",
                "silver": "bronze + 5, cap 95",
                "gold": "at least 96; X-Factors require Gold",
            },
            "grantModel": {
                "maxEquipped": 4,
                "events": {
                    "weekly_gold": 1,
                    "season_tier1": 1,
                    "season_tier3": 1,
                    "career_minor": 1,
                    "career_major": 1,
                    "career_historic": 1,
                    "award": 1,
                    "championship": 1,
                },
            },
        },
        "abilities": abilities,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {len(abilities)} abilities to {OUT_PATH}")
    print("rti eligible", sum(1 for a in abilities if a["rtiEligible"]))


if __name__ == "__main__":
    main()
