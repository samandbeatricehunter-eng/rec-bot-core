import csv
import html
import json
import re
import ssl
import struct
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


USER_AGENT = "REC-Leagues-rights-conscious-headshot-collector/1.0 (research; contact via project owner)"
WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKI_REST = "https://en.wikipedia.org/api/rest_v1/page/summary/"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
FREE_MARKERS = ("public domain", "cc0", "cc by", "cc-by", "creative commons", "gfdl")
SSL_CONTEXT = ssl._create_unverified_context()
LAST_HTTP = 0.0


def polite_open(req, timeout):
    global LAST_HTTP
    for attempt in range(3):
        delay = 0.4 - (time.monotonic() - LAST_HTTP)
        if delay > 0:
            time.sleep(delay)
        try:
            response = urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT)
            LAST_HTTP = time.monotonic()
            return response
        except urllib.error.HTTPError as exc:
            LAST_HTTP = time.monotonic()
            if exc.code != 429 or attempt == 2:
                raise
            time.sleep(4 * (attempt + 1))


def api(url, params, attempts=1):
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{url}?{query}", headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=12, context=SSL_CONTEXT) as response:
                return json.load(response)
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(min(8, 2 * (2 ** attempt)))


def strip_html(value):
    return html.unescape(re.sub(r"<[^>]+>", "", value or "")).strip()


def page_candidate(name, context="American football NFL player"):
    data = api(WIKI_API, {
        "action": "query", "generator": "search",
        "gsrsearch": f'"{name}" {context}', "gsrnamespace": 0,
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
        title = re.sub(r"[^a-z0-9]", "", p.get("title", "").lower())
        if norm not in title:
            continue
        source = raster_source(p)
        if source and p.get("pageimage"):
            return p, source
    return None, None


def wiki_rest_portrait(name):
    slug = urllib.parse.quote(name.replace(" ", "_"))
    req = urllib.request.Request(WIKI_REST + slug, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with polite_open(req, 12) as response:
        data = json.load(response)
    if data.get("type") in {"disambiguation", "nonexistent"}:
        return None
    image = data.get("originalimage") or data.get("thumbnail") or {}
    source = image.get("source")
    if not source or not is_raster_url(source):
        return None
    source = source.split("?")[0]
    page_url = ((data.get("content_urls") or {}).get("desktop") or {}).get("page") or f"https://en.wikipedia.org/wiki/{slug}"
    return {"canonicalurl": page_url, "title": data.get("title") or name, "pageimage": Path(urllib.parse.urlparse(source).path).name}, source


def commons_candidate(name, context="portrait"):
    data = api(COMMONS_API, {
        "action": "query", "generator": "search", "gsrsearch": f'"{name}" {context}',
        "gsrnamespace": 6, "gsrlimit": 8, "prop": "imageinfo",
        "iiprop": "url|mime|size|extmetadata", "iiurlwidth": 1400,
        "format": "json", "formatversion": 2,
    })
    wanted = re.sub(r"[^a-z0-9]", "", name.lower())
    for p in data.get("query", {}).get("pages", []):
        title = re.sub(r"[^a-z0-9]", "", (p.get("title") or "").lower())
        if wanted not in title:
            continue
        info = (p.get("imageinfo") or [{}])[0]
        if info.get("mime", "").startswith("image/") and "svg" not in info.get("mime", ""):
            source = info.get("thumburl") or info.get("url")
            if source and is_raster_url(source):
                return p, source, info
    return None, None, None


def html_candidate(name, context="portrait"):
    slug = urllib.parse.quote(name.replace(" ", "_"))
    page_url = f"https://en.wikipedia.org/wiki/{slug}"
    req = urllib.request.Request(page_url, headers={"User-Agent": USER_AGENT})
    with polite_open(req, 12) as response:
        body = response.read().decode("utf-8", "replace")
    # If the exact title is a disambiguation or has no lead image, use contextual search.
    if "may refer to:" in body.lower() or "og:image" not in body:
        q = urllib.parse.quote_plus(f'"{name}" {context}')
        search_url = f"https://en.wikipedia.org/w/index.php?search={q}&title=Special%3ASearch&ns0=1"
        req = urllib.request.Request(search_url, headers={"User-Agent": USER_AGENT})
        with polite_open(req, 12) as response:
            search_body = response.read().decode("utf-8", "replace")
        hit = re.search(r'<div class="mw-search-result-heading">\s*<a href="([^"]+)"', search_body)
        if hit:
            page_url = urllib.parse.urljoin("https://en.wikipedia.org", html.unescape(hit.group(1)))
            req = urllib.request.Request(page_url, headers={"User-Agent": USER_AGENT})
            with polite_open(req, 12) as response:
                body = response.read().decode("utf-8", "replace")
    match = re.search(r'<meta property="og:image" content="([^"]+)"', body)
    if not match:
        return None, None
    return page_url, html.unescape(match.group(1))


ESPN_HEADSHOT_SPORT = {
    "28": "nfl",
    "23": "college-football",
    "10": "mlb",
}


def espn_uid_headshot(uid):
    match = re.search(r"s:\d+~l:(\d+)~a:(\d+)", uid or "")
    if not match:
        return None
    sport = ESPN_HEADSHOT_SPORT.get(match.group(1))
    if not sport:
        return None
    return f"https://a.espncdn.com/i/headshots/{sport}/players/full/{match.group(2)}.png"


SKIP_WIKI = False


def is_raster_url(url):
    return not urllib.parse.urlparse(url).path.lower().endswith(".svg")


def is_raster_bytes(data):
    if not data or len(data) < 24:
        return False
    if data.startswith(b"\x89PNG") or data.startswith(b"\xff\xd8\xff") or data.startswith(b"GIF8"):
        return True
    return data.startswith(b"RIFF") and data[8:12] == b"WEBP"


def raster_source(page):
    for image in (page.get("original"), page.get("thumbnail")):
        source = (image or {}).get("source")
        if source and is_raster_url(source):
            return source
    return None


def strip_png_metadata(data):
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return data
    out = bytearray(data[:8])
    offset = 8
    while offset + 8 <= len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        chunk_type = data[offset + 4:offset + 8]
        chunk = data[offset:offset + 12 + length]
        if chunk_type in {b"IHDR", b"PLTE", b"IDAT", b"tRNS", b"IEND"}:
            out.extend(chunk)
        offset += 12 + length
        if chunk_type == b"IEND":
            break
    return bytes(out)


def save_fitted(data, target):
    with Image.open(BytesIO(strip_png_metadata(data))) as source:
        source = ImageOps.exif_transpose(source).convert("RGB")
        fitted = ImageOps.pad(source, (1024, 1024), method=Image.Resampling.LANCZOS, color=(238, 240, 244), centering=(0.5, 0.42))
        fitted.save(target, "PNG", optimize=True)


def espn_candidate(name):
    url = "https://site.web.api.espn.com/apis/search/v2?" + urllib.parse.urlencode({"query": name, "limit": 10})
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with polite_open(req, 12) as response:
        data = json.load(response)
    wanted = re.sub(r"[^a-z0-9]", "", name.lower())
    choices = []
    for group in data.get("results", []):
        if group.get("type") != "player":
            continue
        for item in group.get("contents", []):
            got = re.sub(r"[^a-z0-9]", "", item.get("displayName", "").lower())
            if got == wanted:
                choices.append(item)
    choices.sort(key=lambda item: (
        0 if item.get("description") == "NFL" else 1 if item.get("description") == "NCAAF" else 2,
        0 if (item.get("image") or {}).get("default") else 1,
    ))
    urls = []
    for item in choices:
        image = (item.get("image") or {}).get("default") or espn_uid_headshot(item.get("uid"))
        if image and is_raster_url(image):
            urls.append((item.get("link", {}).get("web", ""), image))
    return urls


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
    if target.exists() and target.stat().st_size >= 20_000:
        return None
    search_name = player.get("search_name") or player["name"]
    search_context = player.get("search_context") or "portrait"
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
        page = None
        url = None
        if player.get("subject_type") in (None, "nfl", "athlete"):
            for page_url, candidate in espn_candidate(search_name):
                try:
                    data = download(candidate)
                except Exception:
                    continue
                if not is_raster_bytes(data):
                    continue
                try:
                    save_fitted(data, target)
                except Exception:
                    continue
                row.update({
                    "source_page": page_url or "", "source_image_url": candidate, "creator": "ESPN",
                    "license": "ESPN source; redistribution permission not established", "license_url": "",
                    "rights_status": "review_required",
                    "notes": "License metadata was absent or not clearly reusable; manual permission/review required before commercial use.",
                })
                return row
        skip_wiki = "--espn-only" in sys.argv
        if not skip_wiki:
            try:
                rest = wiki_rest_portrait(search_name)
                if rest:
                    page, url = rest
                    info = image_metadata(page.get("pageimage", "")) or info
            except urllib.error.HTTPError as exc:
                if exc.code == 429:
                    globals()["SKIP_WIKI"] = True
            except Exception:
                pass
        if not url and not skip_wiki:
            try:
                page, url = page_candidate(search_name, search_context)
                if page:
                    info = image_metadata(page.get("pageimage", ""))
            except urllib.error.HTTPError as exc:
                if exc.code == 429:
                    globals()["SKIP_WIKI"] = True
            except Exception:
                pass
        if not url and not skip_wiki and not SKIP_WIKI:
            try:
                cp, source, wiki_info = commons_candidate(search_name, search_context)
                if cp:
                    url = source
                    info = wiki_info or {}
                    page = {"title": cp.get("title", ""), "canonicalurl": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(cp.get("title", "").replace(" ", "_"))}
            except urllib.error.HTTPError as exc:
                if exc.code == 429:
                    globals()["SKIP_WIKI"] = True
                    url = None
        if not url or not is_raster_url(url):
            raise RuntimeError("No suitable raster image located")
        data = download(url)
        if not is_raster_bytes(data):
            raise RuntimeError("Located image was not a raster photo")
        save_fitted(data, target)
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
    extra = sys.argv[3:]
    supplied_dir = next((Path(arg) for arg in extra if not arg.startswith("--")), None)
    images = root / "images"
    images.mkdir(parents=True, exist_ok=True)
    players = json.loads(source.read_text(encoding="utf-8"))
    rows = []
    # Wikimedia rate-limits bursty clients; modest concurrency keeps this reproducible.
    with ThreadPoolExecutor(max_workers=1) as pool:
        futures = {pool.submit(process, p, images, supplied_dir): p for p in players}
        for i, future in enumerate(as_completed(futures), 1):
            row = future.result()
            if row is None:
                continue
            rows.append(row)
            print(f"[{i}/{len(players)}] {row['name']}: {row['rights_status']}", flush=True)
    if not rows:
        print(json.dumps({"zip": None, "summary": {"skipped_existing": True}}))
        return
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
    print(json.dumps({"dir": str(root), "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
