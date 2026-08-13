"""Compare All-Pro Football 2K8 spreadsheet vs rec_legend_catalog names."""
from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

import openpyxl

XLSX = Path(r"c:\Users\josh_\Downloads\all-pro_football_2k8.xlsx")
SEED_GLOBS = [
    Path("supabase/migrations/202607010005_rec_legend_catalog_seed.sql"),
    Path("supabase/migrations/202607020001_rec_legend_catalog_missing_five.sql"),
    Path("supabase/migrations/202607060004_madden_legend_catalog_add_luke_kuechly.sql"),
]


def normalize(name: str) -> str:
    n = name.lower().strip()
    n = n.replace("’", "'").replace("‘", "'")
    # strip nicknames in quotes: Ed "Too Tall" Jones -> Ed Jones
    n = re.sub(r'\s*"[^"]+"\s*', " ", n)
    n = re.sub(r"\s+", " ", n)
    # drop periods for O.J. vs OJ
    n = n.replace(".", "")
    return n.strip()


def last_first_keys(name: str) -> set[str]:
    parts = normalize(name).split()
    if len(parts) < 2:
        return {normalize(name)}
    # last token + first token
    return {
        normalize(name),
        f"{parts[-1]} {parts[0]}",
        parts[-1],  # last name only — used carefully
    }


def parse_sheet():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    ws = wb["All-Pro Football 2K8"]
    players = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[1]:
            continue
        players.append(
            {
                "pos": str(row[0] or "").strip(),
                "name": str(row[1]).strip(),
                "class": str(row[2] or "").strip(),
                "abilities": str(row[3] or "").strip(),
            }
        )
    return players


def parse_seed_names() -> list[tuple[str, str]]:
    """Return list of (name, position) from SQL seed files."""
    out: list[tuple[str, str]] = []
    for path in SEED_GLOBS:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        # ('Name', 'POS',
        for m in re.finditer(
            r"\(\s*'((?:[^']|'')+)'\s*,\s*'(QB|HB|FB|WR|TE|OL|DL|LB|DB|K|P|C|G|T|DE|DT|CB|S|FS|SS|MLB|OLB|EDGE)'",
            text,
        ):
            name = m.group(1).replace("''", "'")
            out.append((name, m.group(2)))
    return out


def main():
    players = parse_sheet()
    print(f"SPREADSHEET_TOTAL={len(players)}")
    by_class = collections.Counter(p["class"] for p in players)
    print("BY_CLASS=" + json.dumps(dict(by_class), sort_keys=True))
    by_pos = collections.Counter(p["pos"] for p in players)
    print("BY_POS=" + json.dumps(dict(sorted(by_pos.items()))))

    seed = parse_seed_names()
    print(f"SEED_CATALOG_ROWS={len(seed)}")
    seed_names = [n for n, _ in seed]
    seed_norm = {normalize(n): n for n in seed_names}
    seed_last = collections.defaultdict(list)
    for n in seed_names:
        parts = normalize(n).split()
        if parts:
            seed_last[parts[-1]].append(n)

    exact = []
    fuzzy = []
    missing = []

    for p in players:
        key = normalize(p["name"])
        if key in seed_norm:
            exact.append((p, seed_norm[key]))
            continue
        # try without middle initials
        parts = key.split()
        collapsed = None
        if len(parts) >= 3:
            collapsed = f"{parts[0]} {parts[-1]}"
            if collapsed in seed_norm:
                fuzzy.append((p, seed_norm[collapsed], "drop_middle"))
                continue
        # last-name unique match
        last = parts[-1] if parts else ""
        cands = seed_last.get(last, [])
        # also try matching first+last against seed first+last
        matched = None
        for cand in cands:
            cparts = normalize(cand).split()
            if len(parts) >= 2 and len(cparts) >= 2 and parts[0] == cparts[0] and parts[-1] == cparts[-1]:
                matched = cand
                break
        if matched:
            fuzzy.append((p, matched, "first_last"))
            continue
        missing.append(p)

    print(f"EXACT_MATCH={len(exact)}")
    print(f"FUZZY_MATCH={len(fuzzy)}")
    print(f"IN_CATALOG_TOTAL={len(exact) + len(fuzzy)}")
    print(f"NOT_IN_CATALOG={len(missing)}")

    # tier breakdown of matches
    matched_players = [p for p, *_ in exact] + [t[0] for t in fuzzy]
    print("MATCHED_BY_CLASS=" + json.dumps(dict(collections.Counter(p["class"] for p in matched_players)), sort_keys=True))
    print("MISSING_BY_CLASS=" + json.dumps(dict(collections.Counter(p["class"] for p in missing)), sort_keys=True))

    print("\n--- MATCHED (name -> catalog) ---")
    for p, cat in exact:
        print(f"  [{p['class']}] {p['name']} ({p['pos']}) == {cat}")
    for p, cat, how in fuzzy:
        print(f"  [{p['class']}] {p['name']} ({p['pos']}) ~= {cat} ({how})")

    print("\n--- NOT IN CATALOG (sample first 40) ---")
    for p in missing[:40]:
        print(f"  [{p['class']}] {p['name']} ({p['pos']})")
    if len(missing) > 40:
        print(f"  ... +{len(missing) - 40} more")

    # catalog names not in 2k8
    matched_norm = {normalize(p["name"]) for p in matched_players}
    for _, cat in exact:
        matched_norm.add(normalize(cat))
    for _, cat, _ in fuzzy:
        matched_norm.add(normalize(cat))
    catalog_only = [n for n in seed_names if normalize(n) not in matched_norm]
    # also check first+last
    sheet_fl = set()
    for p in players:
        parts = normalize(p["name"]).split()
        if len(parts) >= 2:
            sheet_fl.add(f"{parts[0]} {parts[-1]}")
        sheet_fl.add(normalize(p["name"]))
    catalog_only2 = []
    for n in seed_names:
        parts = normalize(n).split()
        fl = f"{parts[0]} {parts[-1]}" if len(parts) >= 2 else normalize(n)
        if normalize(n) not in sheet_fl and fl not in sheet_fl:
            catalog_only2.append(n)
    print(f"\nCATALOG_NOT_IN_2K8={len(catalog_only2)}")


if __name__ == "__main__":
    main()
