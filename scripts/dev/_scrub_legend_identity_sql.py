import re
from pathlib import Path

sql_path = Path("supabase/migrations/20260909120000_backfill_legend_catalog_identity.sql")
sql = sql_path.read_text(encoding="utf-8")

DROP_IDS = {
    "16dd69a7-ae34-4545-9227-840736d9ade5",  # Carl Lewis -> Woodley Lewis
    "b32fe257-9ec7-4739-a4a9-7f11a3b29bcd",  # John Brodie -> Brodie Croyle
    "294048b6-3cde-44b3-8697-8a618ad936ac",  # Night Train Lane -> Jeremy Lane
    "3d737905-8bb3-4d94-af04-5100aad2362d",  # Bob Brown RT -> DL page
}

COLLEGE_FIX = {
    "Western Carolina University": "Western Carolina",
    "Bethune–Cookman": "Bethune-Cookman",
}

# Drop garbage colleges like "1956–1957)" or "1947–1949)"
GARBAGE_COLLEGE = re.compile(r"college = '[^']*\d{4}[^']*'")

lines_out = []
for line in sql.splitlines():
    m = re.search(r"where id = '([0-9a-f-]+)'", line)
    if m and m.group(1) in DROP_IDS:
        continue
    if GARBAGE_COLLEGE.search(line):
        # Keep jersey-only updates; strip college if present.
        if "jersey_number" in line and "college" in line:
            line = re.sub(r", college = '[^']*'", "", line)
            line = re.sub(r", [^,]*\d{4}[^;]*;", ";", line)
            # cleanup comment remnant after jersey
            line = re.sub(r"(#\d+), [^;]+;", r"\1;", line)
        elif "college" in line and "jersey_number" not in line and "hand" not in line:
            continue
        else:
            line = re.sub(r",? ?college = '[^']*'", "", line)
            line = re.sub(r"set\s+,", "set ", line)
    for old, new in COLLEGE_FIX.items():
        line = line.replace(f"college = '{old}'", f"college = '{new}'")
        line = line.replace(f", {old};", f", {new};")
        line = line.replace(f", {old},", f", {new},")
    # Ben Roethlisberger is Miami (OH)
    if "4038112d-76e5-4ce4-93f9-9607c625f197" in line:
        line = line.replace("college = 'Miami'", "college = 'Miami (OH)'")
        line = line.replace(", Miami;", ", Miami (OH);")
    lines_out.append(line)

updates = [l for l in lines_out if l.startswith("update ")]
header = [l for l in lines_out if not l.startswith("update ")]
header = [
    (f"-- {len(updates)} rows updated of 597 catalog entries." if "rows updated" in l else l)
    for l in header
]
sql_path.write_text("\n".join(header + updates) + "\n", encoding="utf-8")
print("updates", len(updates))

# recount mismatches
sql = sql_path.read_text(encoding="utf-8")
bad = []
for line in sql.splitlines():
    m = re.search(r"-- ([^(]+) \(([^)]+)\), .*?; (https://en.wikipedia.org/wiki/(\S+))", line)
    if not m:
        continue
    name, slug = m.group(1).strip(), m.group(4)
    slug_plain = re.sub(r"_\(.*\)$", "", slug).replace("_", " ").replace("%27", "'")
    last = re.sub(r"[^a-z0-9]", "", name.split()[-1].lower())
    s = re.sub(r"[^a-z0-9]", "", slug_plain.lower())
    if last and last not in s and re.sub(r"[^a-z0-9]", "", name.lower()) not in s:
        bad.append(f"{name} -> {slug_plain}")
print("mismatches", bad)
