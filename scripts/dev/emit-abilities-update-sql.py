"""Emit batched UPDATE SQL for legend abilities from shared-catalog-seed.json."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "docs" / "legends" / "shared-catalog-seed.json"
OUT = ROOT / "docs" / "legends" / "_abilities_update.sql"


def main() -> None:
    players = json.loads(SEED.read_text(encoding="utf-8"))
    chunks: list[str] = []
    batch: list[str] = []

    def flush() -> None:
        if not batch:
            return
        vals = ",\n".join(batch)
        chunks.append(
            "UPDATE rec_legend_catalog AS c\n"
            "SET abilities = v.abilities\n"
            "FROM (VALUES\n"
            f"{vals}\n"
            ") AS v(name, abilities)\n"
            "WHERE c.name = v.name;"
        )
        batch.clear()

    for p in players:
        name = str(p["name"]).replace("'", "''")
        ab = json.dumps(p["abilities"], separators=(",", ":")).replace("'", "''")
        batch.append(f"  ('{name}', '{ab}'::jsonb)")
        if len(batch) >= 40:
            flush()
    flush()

    OUT.write_text("\n\n".join(chunks), encoding="utf-8")
    print(f"wrote {len(chunks)} statements for {len(players)} players ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
