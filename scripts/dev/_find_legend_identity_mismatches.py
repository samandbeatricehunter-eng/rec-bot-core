import re
from pathlib import Path

sql = Path("supabase/migrations/20260909120000_backfill_legend_catalog_identity.sql").read_text(encoding="utf-8")
bad = []
for line in sql.splitlines():
    m = re.search(r"-- ([^(]+) \(([^)]+)\), .*?; (https://en.wikipedia.org/wiki/(\S+))", line)
    if not m:
        continue
    name, pos, url, slug = m.group(1).strip(), m.group(2), m.group(3), m.group(4)
    slug_plain = re.sub(r"_\(.*\)$", "", slug).replace("_", " ").replace("%27", "'")

    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]", "", s.lower())

    last = norm(name.split()[-1])
    s = norm(slug_plain)
    if last and last not in s and norm(name) not in s:
        bad.append(f"{name} ({pos}) -> {slug_plain}")

print("mismatches", len(bad))
for row in bad:
    print(row)
