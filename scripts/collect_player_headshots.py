import csv
import html
import json
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


USER_AGENT = "REC-Leagues-rights-conscious-headshot-collector/1.0 (research; contact via project owner)"
WIKI_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
FREE_MARKERS = ("public domain", "cc0", "cc by", "cc-by", "creative commons", "gfdl")
SSL_CONTEXT = ssl._create_unverified_context()
LAST_HTTP = 0.0


def polite_open(req, timeout):
    global LAST_HTTP
    for attempt in range(5):
        delay = 1.1 - (time.monotonic() - LAST_HTTP)
        if delay > 0:
            time.sleep(delay)
        try:
            response = urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT)
            LAST_HTTP = time.monotonic()
            return response
        except urllib.error.HTTPError as exc:
            LAST_HTTP = time.monotonic()
            if exc.code != 429 or attempt == 4:
                raise
            time.sleep(15 * (attempt + 1))


def api(url, params, attempts=1):
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{url}?{query}", headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=35, context=SSL_CONTEXT) as response:
                return json.load(response)
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(min(30, 3 * (2 ** attempt)))


def strip_html(value):
    return html.unescape(re.sub(r"<[^>]+>", "", value or "")).strip()


def page_candidate(name):
    data = api(WIKI_API, {
        "action": "query", "generator": "search",
        "gsrsearch": f'"{name}" American football NFL player', "gsrnamespace": 0,
        "gsrlimit": 5, "prop": "pageimages|info", "inprop": "url",
        "piprop": "thumbnail|name|original", "pithumbsize": 1400, "format": "json",
        "formatversion": 2,
    })
    pages = data.get("query", {}).get("pages", [])
    norm = re.sub(r"[^a-z0-9]", "", name.lower())
    pages.sort(key=lambda p: (
        0 if re.sub(r"[^a-z0-9]", "", p.get("title", "").lower()) == norm else 1,
        -int(p.get("index", 9999) == 1),
    ))
    for p in pages:
        image = p.get("original") or p.get("thumbnail")
        if image and p.get("pageimage"):
            return p, image["source"]
    return None, None


def commons_candidate(name):
    data = api(COMMONS_API, {
        "action": "query", "generator": "search", "gsrsearch": f'"{name}" football player',
        "gsrnamespace": 6, "gsrlimit": 8, "prop": "imageinfo",
        "iiprop": "url|mime|size|extmetadata", "iiurlwidth": 1400,
        "format": "json", "formatversion": 2,
    })
    for p in data.get("query", {}).get("pages", []):
        info = (p.get("imageinfo") or [{}])[0]
        if info.get("mime", "").startswith("image/"):
            return p, info.get("thumburl") or info.get("url"), info
    return None, None, None


def html_candidate(name):
    slug = urllib.parse.quote(name.replace(" ", "_"))
    page_url = f"https://en.wikipedia.org/wiki/{slug}"
    req = urllib.request.Request(page_url, headers={"User-Agent": USER_AGENT})
    with polite_open(req, 35) as response:
        body = response.read().decode("utf-8", "replace")
    # If the exact title is unrelated or a disambiguation, use Wikipedia's HTML search.
    if "football" not in body.lower() or "og:image" not in body:
        q = urllib.parse.quote_plus(f'"{name}" American football')
        search_url = f"https://en.wikipedia.org/w/index.php?search={q}&title=Special%3ASearch&ns0=1"
        req = urllib.request.Request(search_url, headers={"User-Agent": USER_AGENT})
        with polite_open(req, 35) as response:
            search_body = response.read().decode("utf-8", "replace")
        hit = re.search(r'<div class="mw-search-result-heading">\s*<a href="([^"]+)"', search_body)
        if hit:
            page_url = urllib.parse.urljoin("https://en.wikipedia.org", html.unescape(hit.group(1)))
            req = urllib.request.Request(page_url, headers={"User-Agent": USER_AGENT})
            with polite_open(req, 35) as response:
                body = response.read().decode("utf-8", "replace")
    match = re.search(r'<meta property="og:image" content="([^"]+)"', body)
    if not match:
        return None, None
    return page_url, html.unescape(match.group(1))


def espn_candidate(name):
    url = "https://site.web.api.espn.com/apis/search/v2?" + urllib.parse.urlencode({"query": name, "limit": 10})
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with polite_open(req, 35) as response:
        data = json.load(response)
    wanted = re.sub(r"[^a-z0-9]", "", name.lower())
    choices = []
    for group in data.get("results", []):
        if group.get("type") != "player":
            continue
        for item in group.get("contents", []):
            got = re.sub(r"[^a-z0-9]", "", item.get("displayName", "").lower())
            image = (item.get("image") or {}).get("default")
            if got == wanted and image:
                choices.append(item)
    choices.sort(key=lambda x: 0 if x.get("description") == "NFL" else 1)
    if not choices:
        return None
    item = choices[0]
    return item.get("link", {}).get("web", ""), item["image"]["default"]


def image_metadata(file_title):
    if not file_title:
        return {}
    data = api(WIKI_API, {
        "action": "query", "titles": "File:" + file_title.removeprefix("File:"),
        "prop": "imageinfo", "iiprop": "url|mime|size|extmetadata",
        "format": "json", "formatversion": 2,
    })
    pages = data.get("query", {}).get("pages", [])
    return ((pages[0].get("imageinfo") or [{}])[0] if pages else {})


def meta_value(meta, key):
    return strip_html((meta.get(key) or {}).get("value", ""))


def classify_license(meta):
    license_name = meta_value(meta, "LicenseShortName") or meta_value(meta, "License")
    usage = meta_value(meta, "UsageTerms")
    blob = f"{license_name} {usage}".lower()
    return license_name or usage or "Unknown", ("clearly_reusable" if any(x in blob for x in FREE_MARKERS) else "review_required")


def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with polite_open(req, 60) as response:
        return response.read()


def placeholder(player, target):
    im = Image.new("RGB", (1024, 1024), "#172033")
    draw = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("arial.ttf", 66)
        small = ImageFont.truetype("arial.ttf", 34)
    except Exception:
        font = small = ImageFont.load_default()
    initials = "".join(part[0] for part in re.findall(r"[A-Za-z]+", player["name"])[:3]).upper()
    draw.ellipse((312, 165, 712, 565), fill="#3c4d6b")
    draw.rounded_rectangle((205, 510, 819, 900), radius=90, fill="#3c4d6b")
    draw.text((512, 365), initials, anchor="mm", font=font, fill="white")
    draw.text((512, 950), "IMAGE RIGHTS REVIEW NEEDED", anchor="mm", font=small, fill="#f6c453")
    im.save(target, "PNG", optimize=True)


def supplied_candidate(name, supplied_dir):
    if not supplied_dir:
        return None
    wanted = re.sub(r"[^a-z0-9]", "", name.lower())
    aliases = {"darrellerevis": "darellerevis"}
    acceptable = {wanted, aliases.get(wanted, wanted)}
    for path in supplied_dir.iterdir():
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            candidate = re.sub(r"[^a-z0-9]", "", path.stem.lower())
            if candidate in acceptable:
                return path
    return None


def process(player, output_dir, supplied_dir=None):
    row = {"name": player["name"], "position": player.get("pos", ""), "tier": player.get("tier", ""),
           "filename": player["file"], "source_page": "", "source_image_url": "", "creator": "",
           "license": "", "license_url": "", "rights_status": "", "notes": ""}
    target = output_dir / player["file"]
    try:
        supplied = supplied_candidate(player["name"], supplied_dir)
        if supplied:
            with Image.open(supplied) as source:
                source = ImageOps.exif_transpose(source).convert("RGB")
                fitted = ImageOps.pad(source, (1024, 1024), method=Image.Resampling.LANCZOS, color=(238, 240, 244), centering=(0.5, 0.42))
                fitted.save(target, "PNG", optimize=True)
            row.update({
                "source_page": str(supplied), "source_image_url": "", "creator": "",
                "license": "User supplied; provenance not provided", "license_url": "",
                "rights_status": "user_supplied_rights_unverified",
                "notes": "Preferred user-supplied portrait. Confirm source and commercial redistribution rights before production use.",
            })
            return row
        info = {}
        result = espn_candidate(player["name"])
        page_url, url = result if result else (None, None)
        page = {"canonicalurl": page_url, "title": player["name"]} if page_url else None
        if not url:
            try:
                page_url, url = html_candidate(player["name"])
                if page_url:
                    page = {"canonicalurl": page_url, "title": player["name"]}
            except Exception:
                pass
        if not url:
            cp, url, info = commons_candidate(player["name"])
            if cp:
                page = {"title": cp.get("title", ""), "canonicalurl": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(cp.get("title", "").replace(" ", "_"))}
        if not url:
            raise RuntimeError("No suitable Wikimedia image located")
        raw_path = target.with_suffix(".download")
        raw_path.write_bytes(download(url))
        with Image.open(raw_path) as source:
            source = ImageOps.exif_transpose(source).convert("RGB")
            # Preserve the entire source without distortion; square-pad, then resize.
            fitted = ImageOps.pad(source, (1024, 1024), method=Image.Resampling.LANCZOS, color=(238, 240, 244), centering=(0.5, 0.42))
            fitted.save(target, "PNG", optimize=True)
        raw_path.unlink(missing_ok=True)
        meta = info.get("extmetadata", {})
        license_name, status = classify_license(meta)
        if not meta:
            license_name, status = "ESPN source; redistribution permission not established", "review_required"
        row.update({
            "source_page": (page or {}).get("canonicalurl", ""), "source_image_url": info.get("descriptionurl") or info.get("url") or url,
            "creator": meta_value(meta, "Artist") or meta_value(meta, "Credit"), "license": license_name,
            "license_url": meta_value(meta, "LicenseUrl"), "rights_status": status,
            "notes": "Wikimedia/Wikipedia source; verify attribution and trademark/personality rights for intended commercial use." if status == "clearly_reusable" else "License metadata was absent or not clearly reusable; manual permission/review required before commercial use.",
        })
    except Exception as exc:
        placeholder(player, target)
        row.update({"license": "No image located", "rights_status": "missing_placeholder",
                    "notes": f"A labeled placeholder is included so every roster filename is present. No player photo was redistributed. Error: {exc}"})
    return row


def main():
    source = Path(sys.argv[1])
    root = Path(sys.argv[2])
    supplied_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    images = root / "images"
    images.mkdir(parents=True, exist_ok=True)
    players = json.loads(source.read_text(encoding="utf-8"))
    rows = []
    # Wikimedia rate-limits bursty clients; modest concurrency keeps this reproducible.
    with ThreadPoolExecutor(max_workers=1) as pool:
        futures = {pool.submit(process, p, images, supplied_dir): p for p in players}
        for i, future in enumerate(as_completed(futures), 1):
            row = future.result()
            rows.append(row)
            print(f"[{i}/{len(players)}] {row['name']}: {row['rights_status']}", flush=True)
    rows.sort(key=lambda r: r["filename"])
    fields = list(rows[0])
    with (root / "licenses.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader(); writer.writerows(rows)
    summary = {status: sum(r["rights_status"] == status for r in rows) for status in sorted({r["rights_status"] for r in rows})}
    (root / "README.txt").write_text(
        "REC Leagues legendary NFL player image collection\n\n"
        "Images are standardized to 1024x1024 PNG, square-padded without distortion.\n"
        "See licenses.csv for per-file source and rights metadata. A free-content license does not clear player publicity, team/NFL trademarks, or other commercial-use concerns. Obtain legal review where appropriate.\n\n"
        f"Summary: {json.dumps(summary, indent=2)}\n", encoding="utf-8")
    zip_path = root.with_suffix(".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for path in sorted(root.rglob("*")):
            if path.is_file(): z.write(path, path.relative_to(root.parent))
    print(json.dumps({"zip": str(zip_path), "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
