"""Source legend catalog hand / jersey / college from Wikipedia infoboxes + Wikidata.

Only emit Left when a source actually says left-handed/left-footed. Jersey and
college are filled only from football (or baseball throws) infoboxes.
"""
from __future__ import annotations

import json
import re
import ssl
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "artifacts" / "legend-catalog-identity.json"
CACHE = ROOT / "artifacts" / "legend-identity-cache"
OUT = ROOT / "artifacts" / "legend-identity-updates.json"
SQL = ROOT / "supabase" / "migrations" / "20260909120000_backfill_legend_catalog_identity.sql"
USER_AGENT = "REC-Leagues-legend-identity-research/1.0 (https://github.com; catalog research)"
WIKI = "https://en.wikipedia.org/w/api.php"
SPARQL = "https://query.wikidata.org/sparql"
SSL = ssl._create_unverified_context()
LAST = 0.0

CURATED_LEFT = {
    "Ken Stabler",
    "Tim Tebow",
    "Steve Young",
    "Michael Vick",
    "Morten Andersen",
    "Sebastian Janikowski",
    "Gary Anderson",  # NFL kicker in this catalog (Syracuse, #1)
    "Carl Crawford",  # MLB; throws left
    "Todd Helton",  # MLB; throws left
}

POS_HINT = {
    "QB": "quarterback", "HB": "running back", "FB": "fullback", "WR": "wide receiver",
    "TE": "tight end", "C": "center", "LG": "guard", "RG": "guard", "LT": "tackle",
    "RT": "tackle", "LE": "defensive end", "RE": "defensive end", "DT": "defensive tackle",
    "NT": "nose tackle", "LOLB": "linebacker", "ROLB": "linebacker", "MLB": "linebacker",
    "LLB": "linebacker", "RLB": "linebacker", "CB": "cornerback", "FS": "safety",
    "SS": "safety", "K": "placekicker", "P": "punter",
}

COLLEGE_ALIASES = {
    "university of miami": "Miami",
    "miami (fl)": "Miami",
    "miami hurricanes football": "Miami",
    "university of pittsburgh": "Pitt",
    "pittsburgh": "Pitt",
    "pittsburgh panthers football": "Pitt",
    "university of southern california": "USC",
    "usc trojans football": "USC",
    "pennsylvania state university": "Penn State",
    "penn state nittany lions football": "Penn State",
    "ohio state university": "Ohio State",
    "the ohio state university": "Ohio State",
    "louisiana state university": "LSU",
    "university of california, los angeles": "UCLA",
    "university of california, berkeley": "California",
    "university of texas at austin": "Texas",
    "texas a&m university": "Texas A&M",
    "florida state university": "Florida State",
    "university of notre dame": "Notre Dame",
    "university of alabama": "Alabama",
    "university of michigan": "Michigan",
    "university of georgia": "Georgia",
    "university of oklahoma": "Oklahoma",
    "university of florida": "Florida",
    "university of tennessee": "Tennessee",
    "university of nebraska-lincoln": "Nebraska",
    "university of nebraska": "Nebraska",
    "university of wisconsin–madison": "Wisconsin",
    "university of wisconsin": "Wisconsin",
    "university of oregon": "Oregon",
    "university of washington": "Washington",
    "university of iowa": "Iowa",
    "michigan state university": "Michigan State",
    "university of illinois urbana-champaign": "Illinois",
    "university of illinois": "Illinois",
    "university of minnesota": "Minnesota",
    "clemson university": "Clemson",
    "university of south carolina": "South Carolina",
    "north carolina state university": "NC State",
    "university of north carolina at chapel hill": "North Carolina",
    "university of virginia": "Virginia",
    "virginia tech": "Virginia Tech",
    "georgia institute of technology": "Georgia Tech",
    "university of houston": "Houston",
    "university of louisville": "Louisville",
    "university of kentucky": "Kentucky",
    "university of arkansas": "Arkansas",
    "university of mississippi": "Ole Miss",
    "mississippi state university": "Mississippi State",
    "university of missouri": "Missouri",
    "university of kansas": "Kansas",
    "university of colorado boulder": "Colorado",
    "university of colorado": "Colorado",
    "university of arizona": "Arizona",
    "arizona state university": "Arizona State",
    "university of utah": "Utah",
    "brigham young university": "BYU",
    "stanford university": "Stanford",
    "northwestern university": "Northwestern",
    "purdue university": "Purdue",
    "indiana university bloomington": "Indiana",
    "indiana university": "Indiana",
    "university of maryland, college park": "Maryland",
    "university of maryland": "Maryland",
    "syracuse university": "Syracuse",
    "university of cincinnati": "Cincinnati",
    "west virginia university": "West Virginia",
    "oklahoma state university–stillwater": "Oklahoma State",
    "oklahoma state university": "Oklahoma State",
    "kansas state university": "Kansas State",
    "texas christian university": "TCU",
    "baylor university": "Baylor",
    "southern methodist university": "SMU",
    "rice university": "Rice",
    "university of tulsa": "Tulsa",
    "tulane university": "Tulane",
    "university of memphis": "Memphis",
    "wake forest university": "Wake Forest",
    "duke university": "Duke",
    "vanderbilt university": "Vanderbilt",
    "university of chicago": "Chicago",
    "united states military academy": "Army",
    "united states naval academy": "Navy",
    "jackson state university": "Jackson State",
    "grambling state university": "Grambling",
    "grambling state": "Grambling",
    "marshall university": "Marshall",
    "james madison university": "James Madison",
    "university of akron": "Akron",
    "louisiana tech university": "Louisiana Tech",
    "university of southern mississippi": "Southern Miss",
    "south dakota state university": "South Dakota State",
    "san diego state university": "San Diego State",
    "san jose state university": "San Jose State",
    "university of hawaii": "Hawaii",
    "university of nevada, las vegas": "UNLV",
    "university of texas at el paso": "UTEP",
    "texas tech university": "Texas Tech",
    "boston college": "Boston College",
    "university of miami (ohio)": "Miami (OH)",
    "miami university": "Miami (OH)",
    "southern mississippi": "Southern Miss",
    "california golden bears football": "California",
    "alabama crimson tide football": "Alabama",
    "auburn tigers football": "Auburn",
    "auburn university": "Auburn",
}

FOOTBALL_INFOBOX = re.compile(
    r"\{\{\s*infobox\s+(?:nfl|college football|american football|pro football hall of fame|gridiron football)[^|}]*",
    re.I,
)
BASEBALL_INFOBOX = re.compile(r"\{\{\s*infobox\s+baseball", re.I)
PERSON_INFOBOX = re.compile(r"\{\{\s*infobox\s+(?:person|actor|writer|wrestler|musician)", re.I)
LEFT_RE = re.compile(
    r"""
    (?:
        left[-\s]handed\s+(?:quarterback|passer|thrower|pitcher|batter)?
        | throws?\s+left(?:[-\s]handed)?
        | left[-\s]footed(?:\s+(?:kicker|punter|placekicker|place-kicker))?
        | kicks?\s+left[-\s]footed
        | left[-\s]footed\s+(?:kicker|punter|placekicker)
        | a\s+lefty\s+(?:quarterback|kicker|punter)
    )
    """,
    re.I | re.X,
)
FALSE_LEFT = re.compile(r"left[-\s](?:tackle|guard|end|outside|side|the|school|for|over)", re.I)


def get_json(url: str, timeout: int = 25) -> dict:
    global LAST
    delay = 0.35 - (time.monotonic() - LAST)
    if delay > 0:
        time.sleep(delay)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=SSL) as response:
                LAST = time.monotonic()
                return json.load(response)
        except urllib.error.HTTPError as exc:
            LAST = time.monotonic()
            if exc.code in {429, 503} and attempt < 3:
                time.sleep(2.5 * (attempt + 1))
                continue
            raise
    return {}


def search_name(name: str) -> str:
    cleaned = re.sub(r'\s*"[^"]+"\s*', " ", name)
    cleaned = re.sub(r"^(?:Mean|Night Train)\s+", "", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def last_token(name: str) -> str:
    parts = re.sub(r"[^A-Za-z0-9.'\- ]", " ", search_name(name)).split()
    return parts[-1].lower() if parts else ""


def first_token(name: str) -> str:
    parts = re.sub(r"[^A-Za-z0-9.'\- ]", " ", search_name(name)).split()
    return parts[0].lower() if parts else ""


def wiki_search(name: str, position: str) -> str | None:
    hint = POS_HINT.get(position, "football")
    query = f'"{search_name(name)}" {hint}'
    data = get_json(WIKI + "?" + urllib.parse.urlencode({
        "action": "query", "list": "search", "srsearch": query, "srlimit": 5,
        "srnamespace": 0, "format": "json", "formatversion": 2,
    }))
    hits = data.get("query", {}).get("search") or []
    if not hits:
        data = get_json(WIKI + "?" + urllib.parse.urlencode({
            "action": "query", "list": "search", "srsearch": search_name(name),
            "srlimit": 5, "srnamespace": 0, "format": "json", "formatversion": 2,
        }))
        hits = data.get("query", {}).get("search") or []
    last = last_token(name)
    first = first_token(name)
    for hit in hits:
        title = (hit.get("title") or "").lower()
        snippet = re.sub(r"<[^>]+>", " ", hit.get("snippet") or "").lower()
        if last and last not in title and last not in snippet:
            continue
        if first and first not in title and first not in snippet and first not in {"y.a.", "ya", "a.j.", "aj"}:
            # Allow well-known nicknames / initials if last name matched the title.
            if last not in title:
                continue
        return hit["title"]
    return hits[0]["title"] if hits else None


def wiki_wikitext(title: str) -> str:
    data = get_json(WIKI + "?" + urllib.parse.urlencode({
        "action": "query", "titles": title, "prop": "revisions", "rvprop": "content",
        "rvslots": "main", "rvsection": 0, "format": "json", "formatversion": 2,
    }))
    pages = data.get("query", {}).get("pages") or []
    if not pages:
        return ""
    slots = ((pages[0].get("revisions") or [{}])[0].get("slots") or {}).get("main") or {}
    return slots.get("content") or ""


def strip_markup(value: str) -> str:
    text = re.sub(r"<!--.*?-->", "", value, flags=re.S)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S | re.I)
    text = re.sub(r"<ref[^/]*/>", "", text, flags=re.I)
    text = re.sub(r"<br\s*/?>", "|", text, flags=re.I)
    text = re.sub(r"\{\{nbsp\}\}", " ", text, flags=re.I)
    # {{College|School}} / {{cfb|...}} keep inner
    text = re.sub(r"\{\{[^{}|\n]*\|([^{}]+)\}\}", r"\1", text)
    text = re.sub(r"\{\{[^{}]+\}\}", "", text)
    def wiki_link(match: re.Match) -> str:
        inner = match.group(1)
        return inner.split("|")[-1]
    text = re.sub(r"\[\[([^\[\]]+)\]\]", wiki_link, text)
    text = re.sub(r"'{2,}", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" |,;")


def infobox_field(wikitext: str, names: tuple[str, ...]) -> str | None:
    pattern = re.compile(
        r"^\|\s*(" + "|".join(names) + r")\s*=\s*(.*)$",
        re.I | re.M,
    )
    matches = pattern.findall(wikitext)
    if not matches:
        return None
    raw = matches[0][1] if isinstance(matches[0], tuple) else matches[0]
    # continuation lines until next |
    return strip_markup(raw)


def normalize_college(raw: str) -> str | None:
    if not raw:
        return None
    parts = [p.strip() for p in re.split(r"[|;/]| and ", raw) if p.strip()]
    # Last school is usually the draft school for transfers.
    candidate = parts[-1] if parts else raw
    candidate = re.sub(r"\s+\(.*\)$", "", candidate).strip()
    candidate = re.sub(r"\s+football$", "", candidate, flags=re.I).strip()
    if len(candidate) < 2 or len(candidate) > 40:
        return None
    if candidate.lower() in {"none", "n/a", "undrafted", "did not play"}:
        return None
    alias = COLLEGE_ALIASES.get(candidate.lower())
    if alias:
        return alias
    # "Alabama Crimson Tide" → Alabama if we can
    for suffix in (" Crimson Tide", " Trojans", " Buckeyes", " Tigers", " Nittany Lions"):
        if candidate.endswith(suffix):
            candidate = candidate[: -len(suffix)].strip()
    return candidate


def parse_number(raw: str) -> int | None:
    if not raw:
        return None
    nums = [int(n) for n in re.findall(r"\b(\d{1,2})\b", raw)]
    nums = [n for n in nums if 0 <= n <= 99]
    if not nums:
        return None
    # Wikipedia NFL bios list the primary/iconic number first when several are present.
    return nums[0]


def detect_left(text: str) -> bool:
    if not text:
        return False
    for match in LEFT_RE.finditer(text):
        window = text[max(0, match.start() - 20): match.end() + 20]
        if FALSE_LEFT.search(window):
            continue
        return True
    return False


def parse_throws(wikitext: str) -> str | None:
    field = infobox_field(wikitext, ("throws", "batsandthrows", "bats_and_throws"))
    if not field:
        return None
    if re.search(r"\bleft\b", field, re.I):
        return "Left"
    if re.search(r"\bright\b", field, re.I):
        return "Right"
    return None


def source_player(row: dict) -> dict:
    name = row["name"]
    cache_path = CACHE / (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") + ".json")
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    result = {
        "id": row["id"],
        "name": name,
        "position": row["position"],
        "title": None,
        "hand": None,
        "jersey_number": None,
        "college": None,
        "source": None,
        "notes": [],
    }
    if name in CURATED_LEFT:
        result["hand"] = "Left"
        result["notes"].append("curated-left")
    try:
        title = wiki_search(name, row["position"])
    except Exception as exc:
        result["notes"].append(f"search-error:{exc}")
        cache_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        return result
    result["title"] = title
    if not title:
        cache_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        return result
    try:
        wikitext = wiki_wikitext(title)
    except Exception as exc:
        result["notes"].append(f"fetch-error:{exc}")
        cache_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        return result
    football = bool(FOOTBALL_INFOBOX.search(wikitext))
    baseball = bool(BASEBALL_INFOBOX.search(wikitext))
    person = bool(PERSON_INFOBOX.search(wikitext)) and not football
    if football:
        college = normalize_college(infobox_field(wikitext, ("college", "alma_mater", "almamater")) or "")
        number = parse_number(infobox_field(wikitext, ("number", "numbers", "currentnumber", "current_number")) or "")
        if college:
            result["college"] = college
        if number is not None:
            result["jersey_number"] = number
        result["source"] = f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"
        if detect_left(wikitext[:8000]):
            result["hand"] = "Left"
            result["notes"].append("wiki-left")
    elif baseball:
        throws = parse_throws(wikitext)
        if throws:
            result["hand"] = throws
            result["notes"].append("baseball-throws")
        college = normalize_college(infobox_field(wikitext, ("college", "alma_mater")) or "")
        if college:
            result["college"] = college
        result["source"] = f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"
    elif not person and detect_left(wikitext[:8000]):
        result["hand"] = "Left"
        result["notes"].append("wiki-left-loose")
        result["source"] = f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"
    cache_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def sparql_hands(names: list[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    for i in range(0, len(names), 80):
        chunk = names[i:i + 80]
        values = " ".join('"' + n.replace('"', "") + '"@en' for n in chunk)
        query = f"""
        SELECT ?name ?handLabel WHERE {{
          VALUES ?name {{ {values} }}
          ?item rdfs:label ?name .
          ?item wdt:P31 wd:Q5 .
          ?item wdt:P552 ?hand .
          {{ ?item wdt:P106 wd:Q19204627 }} UNION {{ ?item wdt:P641 wd:Q41323 }} UNION {{ ?item wdt:P106 wd:Q11774891 }}
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
        }}
        """
        url = SPARQL + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
        try:
            data = get_json(url, timeout=60)
        except Exception as exc:
            print("sparql fail", i, exc)
            continue
        for binding in data.get("results", {}).get("bindings", []):
            name = binding.get("name", {}).get("value")
            hand = binding.get("handLabel", {}).get("value") or ""
            if name and "left" in hand.lower():
                found[name] = "Left"
            elif name and "right" in hand.lower() and name not in found:
                found[name] = "Right"
        print("sparql batch", i, "hits", len(data.get("results", {}).get("bindings", [])))
    return found


def sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    rows = json.loads(CATALOG.read_text(encoding="utf-8"))
    sourced = []
    for index, row in enumerate(rows, 1):
        result = source_player(row)
        sourced.append(result)
        if index % 25 == 0:
            print(f"{index}/{len(rows)} {row['name']} -> {result.get('title')} hand={result.get('hand')} #{result.get('jersey_number')} {result.get('college')}")
    wd_hands = sparql_hands([search_name(r["name"]) for r in rows])
    by_name = {r["name"]: r for r in rows}
    for result in sourced:
        wd = wd_hands.get(result["name"]) or wd_hands.get(search_name(result["name"]))
        if wd == "Left" and result.get("hand") != "Left":
            result["hand"] = "Left"
            result["notes"].append("wikidata-left")
        if result["name"] in CURATED_LEFT:
            result["hand"] = "Left"
    updates = []
    for result, row in zip(sourced, rows):
        sets = []
        comments = []
        if result.get("hand") == "Left" and str(row.get("hand") or "").lower() != "left":
            sets.append("hand = 'Left'")
            comments.append("hand")
        if row.get("jersey_number") is None and result.get("jersey_number") is not None:
            sets.append(f"jersey_number = {int(result['jersey_number'])}")
            comments.append(f"#{result['jersey_number']}")
        if not (row.get("college") or "").strip() and result.get("college"):
            sets.append(f"college = {sql_str(result['college'])}")
            comments.append(result["college"])
        if sets:
            note = ", ".join(comments)
            src = result.get("source") or ("curated" if result["name"] in CURATED_LEFT else "sourced")
            updates.append(
                f"update rec_legend_catalog set {', '.join(sets)} "
                f"where id = '{row['id']}'; -- {row['name']} ({row['position']}), {note}; {src}"
            )
    OUT.write_text(json.dumps({"sourced": sourced, "update_count": len(updates)}, indent=2), encoding="utf-8")
    header = (
        "-- Backfill rec_legend_catalog dominant hand, jersey number, and college.\n"
        "-- Hand: only Left flips are written. Existing Right stays unless a source\n"
        "-- documents left-handed throwing or left-footed kicking. Remaining Right\n"
        "-- values are the catalog default, left unchanged when no left-hand evidence.\n"
        "-- Jersey/college: filled only from football (or baseball) Wikipedia infoboxes.\n"
        f"-- {len(updates)} rows updated of {len(rows)} catalog entries.\n\n"
    )
    SQL.write_text(header + "\n".join(updates) + "\n", encoding="utf-8")
    lefts = [r["name"] for r in sourced if r.get("hand") == "Left"]
    print("LEFT", sorted(lefts))
    print("updates", len(updates), "sql", SQL)


if __name__ == "__main__":
    main()
