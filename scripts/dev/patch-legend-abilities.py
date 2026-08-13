"""PATCH abilities on rec_legend_catalog from shared-catalog-seed.json."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "docs" / "legends" / "shared-catalog-seed.json"


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main() -> None:
    load_env(ROOT / ".env")
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    players = json.loads(SEED.read_text(encoding="utf-8"))
    ok = fail = 0
    for p in players:
        body = json.dumps({"abilities": p["abilities"]}).encode()
        name_q = urllib.parse.quote(p["name"])
        req = urllib.request.Request(
            f"{url}/rest/v1/rec_legend_catalog?name=eq.{name_q}",
            data=body,
            method="PATCH",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                if 200 <= resp.status < 300:
                    ok += 1
                else:
                    fail += 1
                    print("bad status", p["name"], resp.status)
        except urllib.error.HTTPError as e:
            fail += 1
            if fail <= 8:
                print("fail", p["name"], e.code, e.read()[:200])
        except Exception as e:  # noqa: BLE001
            fail += 1
            if fail <= 8:
                print("fail", p["name"], e)
    print(f"ok={ok} fail={fail} total={len(players)}")


if __name__ == "__main__":
    main()
