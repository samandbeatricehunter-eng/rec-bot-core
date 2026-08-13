"""Emit jsonb_to_recordset payloads for MCP ability updates."""
from __future__ import annotations
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "docs" / "legends" / "shared-catalog-seed.json"
OUT = ROOT / "docs" / "legends" / "_abilities_payloads"
OUT.mkdir(exist_ok=True)
players = json.loads(SEED.read_text(encoding="utf-8"))
# skip Jim Otto already patched? still include for idempotency
BATCH = 50
for i in range(0, len(players), BATCH):
    chunk = players[i:i+BATCH]
    payload = [{"name": p["name"], "abilities": p["abilities"]} for p in chunk]
    text = json.dumps(payload, separators=(",", ":"))
    sql = (
        "WITH payload AS (\n"
        "  SELECT * FROM jsonb_to_recordset($json$"
        + text
        + "$json$::jsonb) AS x(name text, abilities jsonb)\n"
        ")\n"
        "UPDATE rec_legend_catalog AS c\n"
        "SET abilities = p.abilities\n"
        "FROM payload AS p\n"
        "WHERE c.name = p.name;\n"
    )
    path = OUT / f"{i//BATCH:02d}.sql"
    path.write_text(sql, encoding="utf-8")
    print(path.name, len(sql), "players", len(chunk))
