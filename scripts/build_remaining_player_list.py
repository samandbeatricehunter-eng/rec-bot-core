import csv
import json
import re
import sys
from pathlib import Path


roster_path = Path(sys.argv[1])
log_path = Path(sys.argv[2])
output_dir = Path(sys.argv[3])

players = json.loads(roster_path.read_text(encoding="utf-8"))
completed = set()
pattern = re.compile(r"^\[\d+/\d+\] (.*?): (user_supplied_rights_unverified|review_required|clearly_reusable)$")
for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines():
    match = pattern.match(line.strip())
    if match:
        completed.add(match.group(1))

remaining = [player for player in players if player["name"] not in completed]
output_dir.mkdir(parents=True, exist_ok=True)

txt_path = output_dir / "remaining_legend_portraits.txt"
txt_path.write_text(
    f"Remaining legend portraits needed: {len(remaining)}\n"
    f"Already completed: {len(completed)}\n\n"
    + "\n".join(f"{i}. {p['name']} — {p['pos']} — {p['tier']} — {p['file']}" for i, p in enumerate(remaining, 1))
    + "\n",
    encoding="utf-8",
)

csv_path = output_dir / "remaining_legend_portraits.csv"
with csv_path.open("w", newline="", encoding="utf-8-sig") as handle:
    writer = csv.DictWriter(handle, fieldnames=["name", "pos", "tier", "ovr", "file"])
    writer.writeheader()
    writer.writerows({key: player.get(key) for key in writer.fieldnames} for player in remaining)

print(json.dumps({"completed": len(completed), "remaining": len(remaining), "txt": str(txt_path), "csv": str(csv_path)}, indent=2))
