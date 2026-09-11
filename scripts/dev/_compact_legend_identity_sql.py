from pathlib import Path

lines = []
for line in Path("artifacts/_apply_legend_identity_only.sql").read_text(encoding="utf-8").splitlines():
    if not line.startswith("update "):
        continue
    out = []
    i = 0
    in_s = False
    while i < len(line):
        c = line[i]
        if c == "'" and not in_s:
            in_s = True
            out.append(c)
            i += 1
            while i < len(line):
                out.append(line[i])
                if line[i] == "'":
                    if i + 1 < len(line) and line[i + 1] == "'":
                        out.append(line[i + 1])
                        i += 2
                        continue
                    in_s = False
                    i += 1
                    break
                i += 1
            continue
        if not in_s and line[i : i + 2] == "--":
            break
        out.append(c)
        i += 1
    lines.append("".join(out).rstrip().rstrip(";") + ";")

text = "\n".join(lines) + "\n"
Path("artifacts/_apply_legend_identity_compact.sql").write_text(text, encoding="utf-8")
print(len(text), text.count("update "))

# also write 4 ~20k batches
batch_size = (len(lines) + 3) // 4
for b in range(4):
    part = lines[b * batch_size : (b + 1) * batch_size]
    Path(f"artifacts/_legend_identity_chunks/part_{b}.sql").write_text("\n".join(part) + "\n", encoding="utf-8")
    print(f"part_{b}", len(part), Path(f"artifacts/_legend_identity_chunks/part_{b}.sql").stat().st_size)
