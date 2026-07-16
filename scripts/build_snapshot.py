#!/usr/bin/env python3
"""Build data/snapshot.json for the Restricted Party Screener.

Compiles the restricted party lists enumerated in Appendix A of the NSF
Dear Colleague Letter "Prohibition on Collaborations with Entities on a
U.S. Prohibited Party List":
https://www.nsf.gov/funding/information/dcl-prohibition-collaborations-entities-us-prohibited-party

Sources (all official; Internet Archive / Federal Register mirrors are used
where the agency site blocks non-browser clients):

  1. Trade.gov Consolidated Screening List (CSL) download -> BIS Entity List,
     BIS Military End-User List, BIS Denied Persons List, OFAC NS-CMIC
     (Annex to E.O. 14032), DDTC ITAR Debarred, State ISN Nonproliferation
     Sanctions.
  2. Federal Register notice of the DoD Section 1260H Chinese Military
     Companies designation (full entity list is in the notice text).
  3. DoD FY24 Section 1286 lists PDF (institutions + foreign talent programs).
  4. FCC Covered List (Secure and Trusted Communications Networks Act sec. 2).
  5. DHS UFLPA Entity List.
  6. CBP Withhold Release Orders & Findings CSV (Active entries).

Usage:
  .venv/bin/python scripts/build_snapshot.py [--refresh]

Downloads are cached in data/cache/ (gitignored); --refresh re-downloads.
The script fails if any list parses to zero entries, and prints per-list
counts for manual verification against the official sources.
"""

import argparse
import csv
import datetime
import html
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache"
OUT = ROOT / "data" / "snapshot.json"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

SOURCES = {
    "csl.csv": "https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.csv",
    # Full 1260H list as published in the Federal Register (91 FR 35189, 2026-06-10).
    "1260h_fr.txt": "https://www.federalregister.gov/documents/full_text/text/2026/06/10/2026-11571.txt",
    # DoD FY24 Section 1286 lists. basicresearch.defense.gov blocks non-browser
    # clients, so fetch the identical document via the Internet Archive.
    "1286.pdf": ("https://web.archive.org/web/2026/https://basicresearch.defense.gov/"
                 "Portals/61/Documents/Academic%20Research%20Security%20Page/"
                 "FY24%20Section%201286%20List%20for%20public%20release_V2.pdf"),
    # fcc.gov blocks non-browser clients; identical page via the Internet Archive.
    "fcc.html": "https://web.archive.org/web/2026/https://www.fcc.gov/supplychain/coveredlist",
    "uflpa.html": "https://www.dhs.gov/uflpa-entity-list",
    "wro_doc.html": "https://www.cbp.gov/document/stats/withhold-release-orders-findings",
}

LISTS = [
    {"id": "1260h", "title": "Section 1260H Chinese Military Companies List",
     "citation": "Section 1260H, NDAA FY2021 (10 U.S.C. 113 note) — 91 FR 35189",
     "agency": "U.S. Department of Defense", "badge": "Department of Defense (DoD)",
     "url": "https://www.defense.gov/News/Releases/"},
    {"id": "1286", "title": "Section 1286 List (Institutions & Foreign Talent Programs)",
     "citation": "Section 1286, John S. McCain NDAA FY2019 (Pub. L. 115-232), as amended — FY24 lists",
     "agency": "U.S. Department of Defense", "badge": "Department of Defense (DoD)",
     "url": "https://basicresearch.defense.gov/Programs/Academic-Research-Security/"},
    {"id": "el", "title": "Entity List",
     "citation": "Supplement No. 4 to 15 CFR Part 744",
     "agency": "U.S. Department of Commerce, Bureau of Industry and Security", "badge": "Commerce / BIS",
     "url": "https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C/part-744"},
    {"id": "meu", "title": "Military End-User (MEU) List",
     "citation": "Supplement No. 7 to 15 CFR Part 744",
     "agency": "U.S. Department of Commerce, Bureau of Industry and Security", "badge": "Commerce / BIS",
     "url": "https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C/part-744"},
    {"id": "dpl", "title": "Denied Persons List",
     "citation": "Persons denied export privileges under 15 CFR Part 764",
     "agency": "U.S. Department of Commerce, Bureau of Industry and Security", "badge": "Commerce / BIS",
     "url": "https://www.bis.gov/licensing/end-user-guidance/denied-persons-list-dpl"},
    {"id": "cmic", "title": "Non-SDN Chinese Military-Industrial Complex Companies (NS-CMIC) List",
     "citation": "Annex to Executive Order 14032, as amended",
     "agency": "U.S. Department of the Treasury, Office of Foreign Assets Control", "badge": "Treasury / OFAC",
     "url": "https://ofac.treasury.gov/sanctions-programs-and-country-information/chinese-military-companies-sanctions"},
    {"id": "dtc", "title": "ITAR Debarred Parties List",
     "citation": "Parties debarred under 22 CFR 127.7 (AECA sec. 38)",
     "agency": "U.S. Department of State, Directorate of Defense Trade Controls", "badge": "State / DDTC",
     "url": "https://www.pmddtc.state.gov/ddtc_public?id=ddtc_kb_article_page&sys_id=c22d1833dbb8d300d0a370131f9619f0"},
    {"id": "isn", "title": "Nonproliferation Sanctions",
     "citation": "Sanctions under various statutory authorities (State/ISN)",
     "agency": "U.S. Department of State, Bureau of International Security and Nonproliferation", "badge": "State / ISN",
     "url": "https://www.state.gov/bureau-of-arms-control-and-nonproliferation/nonproliferation-sanctions"},
    {"id": "fcc", "title": "Covered List (Secure and Trusted Communications Networks Act)",
     "citation": "47 CFR 1.50002; Secure Networks Act sec. 2",
     "agency": "U.S. Federal Communications Commission", "badge": "FCC",
     "url": "https://www.fcc.gov/supplychain/coveredlist"},
    {"id": "uflpa", "title": "UFLPA Entity List",
     "citation": "Uyghur Forced Labor Prevention Act (Pub. L. 117-78) sec. 2(d)(2)(B)",
     "agency": "U.S. Department of Homeland Security", "badge": "DHS",
     "url": "https://www.dhs.gov/uflpa-entity-list"},
    {"id": "wro", "title": "Withhold Release Orders & Findings (Active)",
     "citation": "19 U.S.C. 1307; 19 CFR 12.42",
     "agency": "U.S. Customs and Border Protection", "badge": "CBP",
     "url": "https://www.cbp.gov/document/stats/withhold-release-orders-findings"},
]

CSL_SOURCE_TO_LIST = {
    "Entity List (EL) - Bureau of Industry and Security": "el",
    "Military End User (MEU) List - Bureau of Industry and Security": "meu",
    "Denied Persons List (DPL) - Bureau of Industry and Security": "dpl",
    "Non-SDN Chinese Military-Industrial Complex Companies List (CMIC) - Treasury Department": "cmic",
    "ITAR Debarred (DTC) - State Department": "dtc",
    "Nonproliferation Sanctions (ISN) - State Department": "isn",
}


def fetch(name, refresh=False):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if path.exists() and not refresh:
        return path
    url = SOURCES[name]
    print(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as resp:
        path.write_bytes(resp.read())
    return path


def clean(s):
    s = html.unescape(s)
    s = s.replace("’", "'").replace("‘", "'")
    return re.sub(r"\s+", " ", s).strip(" ;,.")


# ---------------------------------------------------------------- CSL lists

def parse_csl(path):
    entries = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            list_id = CSL_SOURCE_TO_LIST.get(row["source"])
            if not list_id:
                continue
            name = clean(row["name"])
            if not name:
                continue
            aliases = [clean(a) for a in row["alt_names"].split(";") if clean(a)]
            entries.append({"n": name, "a": aliases, "l": list_id})
    return entries


# ------------------------------------------------------- DoD 1260H (FR text)

def parse_1260h(path):
    text = path.read_text(encoding="utf-8", errors="replace")
    text = text.replace("<bullet>", "@BULLET@")              # keep marker through tag strip
    text = re.sub(r"<[^>]+>", "", text)                      # strip HTML tags
    text = re.sub(r"\[\[Page \d+\]\]", "", text)             # page markers
    start = text.find("in accordance with section 1260H:")
    if start == -1:
        raise ValueError("1260H: intro sentence not found")
    text = text[start + len("in accordance with section 1260H:"):]

    # Page transitions can inject a blank line mid-paragraph; rejoin any
    # paragraph whose parentheses are unbalanced with the one that follows.
    raw_paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", text)]
    paras = []
    for p in raw_paras:
        if not p:
            continue
        if paras and paras[-1].count("(") > paras[-1].count(")"):
            paras[-1] += " " + p
        else:
            paras.append(p)

    entries = []
    for para in paras:
        # Everything after the removals announcement is entities REMOVED from
        # the list (plus administrivia) — they must not be included.
        if "should be removed from" in para:
            break
        if "@BULLET@" in para:
            continue
        if re.search(r"Dated:|FR Doc|BILLING CODE|Federal Register Liaison|OSD Federal|Mandarin", para):
            break
        para = para.replace("``", '"').replace("''", '"')
        # Split off the "(and X subsidiaries: A, B, and C)" tail if present.
        subs = []
        m = re.search(r"\(and [^:()]*subsidiar(?:y|ies)[^:()]*:\s*", para)
        if m:
            tail = para[m.end():].strip()
            if tail.endswith(")"):
                tail = tail[:-1]
            subs = [clean(re.sub(r"^and\s+", "", s)) for s in split_top_level(tail)]
            para = para[:m.start()].strip()
        name, aliases = split_parenthetical(para)
        entries.append({"n": name, "a": aliases, "l": "1260h"})
        for sub in subs:
            if sub:
                sub_name, sub_aliases = split_parenthetical(sub)
                entries.append({"n": sub_name, "a": sub_aliases, "l": "1260h",
                                "note": f"Listed as subsidiary of {name}"})
    return entries


COMPANY_SUFFIX = re.compile(r"^(?:Ltd|LLC|L\.L\.C|Inc|Co\b|Corp|Company|Limited|PLC|S\.A)", re.I)


def split_top_level(s):
    """Split an enumeration on commas outside parentheses, keeping company
    suffixes ('... Co., Ltd.') attached to their name."""
    parts, buf, depth = [], [], 0
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))
    merged = []
    for part in parts:
        part = part.strip()
        if merged and COMPANY_SUFFIX.match(re.sub(r"^and\s+", "", part)):
            merged[-1] += ", " + part
        elif part:
            merged.append(part)
    return merged


def extract_parens(s):
    """Return (text outside parens, [top-level parenthetical contents])."""
    base, parens, buf, depth = [], [], [], 0
    for ch in s:
        if ch == "(":
            depth += 1
            if depth == 1:
                continue
        elif ch == ")":
            depth = max(0, depth - 1)
            if depth == 0:
                parens.append("".join(buf))
                buf = []
                continue
        (buf if depth else base).append(ch)
    return clean("".join(base)), parens


def split_parenthetical(s):
    """'Alibaba Group Holding Limited (Alibaba)' -> name + alias list.

    Handles nesting: 'X Co. (formerly Y Ltd. (ZEMIC))' -> aliases
    ['Y Ltd.', 'ZEMIC'].
    """
    s = clean(s)
    name, parens = extract_parens(s)
    aliases = []

    def add(p):
        p = clean(re.sub(r"^(?:formerly|now|d/b/a)\s+", "", p, flags=re.I))
        if not p:
            return
        inner_base, inner = extract_parens(p)
        if inner_base:
            aliases.append(inner_base)
        for q in inner:
            add(q)

    for p in parens:
        add(p)
    name = name or s
    return name, [a for a in aliases if a and a.lower() != name.lower()]


ALIAS_MARKER = re.compile(
    r"^(?:and\s+)?(?:(?:one|two|three|four|five|\d+)\s+)?"
    r"(?:alias(?:es)?:?|including\s+(?:one|two|three|four|five|\d+)?\s*alias(?:es)?:?|"
    r"also known as|formerly known as|a\.?k\.?a\.?)\s*", re.I)


def split_alias_parens(s):
    """Split a name with alias-marker parentheticals, respecting nesting.

    'Hoshine Silicon Industry (Shanshan) Co., Ltd (including one alias:
    Hesheng Silicon Industry (Shanshan) Co.) and subsidiaries'
    -> ('Hoshine Silicon Industry (Shanshan) Co., Ltd and subsidiaries',
        ['Hesheng Silicon Industry (Shanshan) Co.'])

    Parentheticals that do not start with an alias marker (e.g. '(Shanshan)')
    are kept as part of the name.
    """
    s = clean(s)
    name_parts, aliases, i = [], [], 0
    while i < len(s):
        if s[i] == "(":
            depth, j = 1, i + 1
            while j < len(s) and depth:
                depth += {"(": 1, ")": -1}.get(s[j], 0)
                j += 1
            inner = s[i + 1:j - 1]
            if ALIAS_MARKER.match(inner):
                body = ALIAS_MARKER.sub("", inner, count=1)
                for part in re.split(r";\s*", body):
                    part = ALIAS_MARKER.sub("", clean(part), count=1)
                    part = clean(re.sub(r"^and\s+", "", part))
                    if part:
                        aliases.append(part)
            else:
                name_parts.append(s[i:j])
            i = j
        else:
            name_parts.append(s[i])
            i += 1
    return clean("".join(name_parts)), aliases


# ------------------------------------------------------ DoD 1286 (PDF lists)

def parse_1286(path):
    from pypdf import PdfReader
    reader = PdfReader(str(path))
    text = "\n".join(page.extract_text() for page in reader.pages)

    # Pass 1: drop page numbers and heading fragments.
    lines = []
    for ln in (l.strip() for l in text.split("\n")):
        if not ln or re.fullmatch(r"\d+", ln) or ln.startswith("Interests"):
            continue
        if re.match(r"Countries with Specified|Fiscal Year|Defense Authorization", ln):
            continue
        lines.append(ln)

    # Pass 2: rejoin lines wrapped by the PDF layout.
    joined = []
    for ln in lines:
        prev = joined[-1] if joined else ""
        wrapped = prev and not re.match(r"Table\s+\d", prev) and (
            prev.count("(") > prev.count(")")
            or (not ln.startswith("•") and not re.match(r"Table\s+\d", ln)
                and (prev.endswith(",") or ln[0].islower())))
        if wrapped:
            joined[-1] += " " + ln
        else:
            joined.append(ln)

    entries, current, note = [], None, None
    in_table = False
    for ln in joined:
        if re.match(r"Table\s+1\s*:", ln):
            in_table, note = True, None
            continue
        if re.match(r"Table\s+2\s*:", ln):
            in_table, note = True, "Foreign talent recruitment program"
            continue
        if not in_table:
            continue
        if ln.startswith("Any program that meets"):
            break                        # final catch-all criterion, not an entity
        if ln.startswith("•"):                           # bullet = alias of previous entry
            if current is not None:
                alias, extra = split_alias_parens(clean(ln.lstrip("•")))
                current["a"] += [a for a in [alias] + extra if a]
            continue
        name, aliases = split_alias_parens(clean(re.sub(r"\ba\.k\.a\.\s*$", "", ln)))
        if not name:
            continue
        current = {"n": name, "a": aliases, "l": "1286"}
        if note:
            current["note"] = note
        entries.append(current)
    return entries


# ------------------------------------------------------------ FCC / UFLPA

def table_cells(html_text):
    for table in re.findall(r"<table.*?</table>", html_text, re.S):
        rows = []
        for row in re.findall(r"<tr.*?</tr>", table, re.S):
            cells = [clean(re.sub(r"<[^>]+>", " ", c))
                     for c in re.findall(r"<t[dh][^>]*>.*?</t[dh]>", row, re.S)]
            rows.append(cells)
        yield rows


def parse_fcc(path):
    html_text = path.read_text(encoding="utf-8", errors="replace")
    entries, seen = [], set()
    for rows in table_cells(html_text):
        header = rows[0] if rows else []
        if not header or "Covered Equipment" not in header[0]:
            continue
        for cells in rows[1:]:
            if not cells or not cells[0]:
                continue
            desc = cells[0]
            # Named producers/providers only. Category-based rows (e.g.
            # foreign-produced UAS or routers with no named entity) cannot be
            # matched by party name and are skipped.
            m = re.search(
                r"(?:produced or provided|produced|provided|supplied(?:,\s*directly or indirectly,)?)\s+by\s+"
                r"(.+?)(?:\s+or any of its\b|\s+and its wholly-owned\b|\s+subject to\b|,?\s+to the extent\b|,?\s+including\b|\s*\.\s*$|$)",
                desc)
            if not m:
                continue
            names = [m.group(1)]
            sub = re.search(r"wholly-owned subsidiary\s+(.+?)(?:\s+subject to\b|,|\.\s*$|$)", desc)
            if sub:
                names.append(sub.group(1))
            for raw in names:
                name = clean(re.sub(r"\s+\.", ".", raw))
                if not name or name.lower() in seen:
                    continue
                seen.add(name.lower())
                entries.append({"n": name, "a": [], "l": "fcc", "note": desc[:200]})
    return entries


def parse_uflpa(path):
    html_text = path.read_text(encoding="utf-8", errors="replace")
    entries = []
    for rows in table_cells(html_text):
        header = rows[0] if rows else []
        if not header or header[0] not in ("Name of Entity", "Entity Name"):
            continue
        for cells in rows[1:]:
            if not cells or not cells[0]:
                continue
            name, aliases = split_alias_parens(cells[0])
            if name:
                entries.append({"n": name, "a": aliases, "l": "uflpa"})
    return entries


# ----------------------------------------------------------------- CBP WRO

def parse_wro(doc_path, refresh=False):
    html_text = doc_path.read_text(encoding="utf-8", errors="replace")
    m = re.search(r'href="(/sites/default/files/[^"]+withhold-release[^"]+\.csv)"', html_text)
    if not m:
        raise ValueError("WRO: csv link not found on document page")
    csv_url = "https://www.cbp.gov" + m.group(1)
    SOURCES["wro.csv"] = csv_url
    csv_path = fetch("wro.csv", refresh=refresh)
    entries, seen = [], set()
    try:
        raw = csv_path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        raw = csv_path.read_text(encoding="cp1252")
    with io.StringIO(raw, newline="") as f:
        for row in csv.DictReader(f):
            if row.get("Status", "").strip().lower() != "active":
                continue
            raw = clean(row.get("Entity", ""))
            if not raw:
                continue
            parts = [clean(p) for p in re.split(r"\s*,?\s*a/k/a\s*", raw, flags=re.I)]
            name, aliases = parts[0], [p for p in parts[1:] if p]
            if not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            note = f"{row.get('WRO/Finding', '')} — {row.get('Country', '')}; {row.get('Merchandise', '')}".strip(" —;")
            entries.append({"n": name, "a": aliases, "l": "wro", "note": note})
    return entries


# -------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download all sources")
    args = ap.parse_args()

    print("Fetching sources...")
    paths = {name: fetch(name, refresh=args.refresh) for name in SOURCES}

    print("Parsing...")
    entries = []
    entries += parse_csl(paths["csl.csv"])
    entries += parse_1260h(paths["1260h_fr.txt"])
    entries += parse_1286(paths["1286.pdf"])
    entries += parse_fcc(paths["fcc.html"])
    entries += parse_uflpa(paths["uflpa.html"])
    entries += parse_wro(paths["wro_doc.html"], refresh=args.refresh)

    counts = {}
    for e in entries:
        counts[e["l"]] = counts.get(e["l"], 0) + 1
    print("\nPer-list counts (verify against official sources):")
    for lst in LISTS:
        n = counts.get(lst["id"], 0)
        print(f"  {n:6d}  {lst['title']}")
        if n == 0:
            sys.exit(f"ERROR: list '{lst['id']}' is empty — refusing to write snapshot")

    snapshot = {
        "built": datetime.date.today().isoformat(),
        "basis": "Appendix A, NSF Dear Colleague Letter NSF 25-110: Prohibition on Collaborations with Entities on a U.S. Prohibited Party List",
        "basisUrl": "https://www.nsf.gov/funding/information/dcl-prohibition-collaborations-entities-us-prohibited-party",
        "lists": [{**lst, "count": counts[lst["id"]]} for lst in LISTS],
        "entries": entries,
    }
    OUT.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\nWrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB, {len(entries)} entries, built {snapshot['built']})")


if __name__ == "__main__":
    main()
