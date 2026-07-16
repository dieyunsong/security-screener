# Restricted Party Screener — Design Spec

**Date:** 2026-07-15
**Owner:** Dieyun Song (dieyun.song@northwestern.edu)
**Repo:** https://github.com/dieyunsong/security-screener (GitHub Pages deployment)

## Purpose

A static web tool that lets Northwestern faculty who receive federal funding
pre-screen collaborators (entities and individuals) against the restricted
party lists enumerated in Appendix A of the NSF Dear Colleague Letter
"Prohibition on Collaborations with Entities on a U.S. Prohibited Party List"
(https://www.nsf.gov/funding/information/dcl-prohibition-collaborations-entities-us-prohibited-party).

It is a **preliminary self-check aid**, not an official Northwestern Export
Controls determination. Authoritative screening is performed via Visual
Compliance through the Export Controls & International Compliance office
(exportcontrols@northwestern.edu,
https://exports.northwestern.edu/federal-regulations/restricted-party-screenings.html).

## Data snapshot (knowledge base)

All data is compiled into `data/snapshot.json` by `scripts/build_snapshot.py`
and embedded statically (no runtime APIs). The snapshot records a build date
shown in the UI. Lists, per Appendix A:

| List | Agency | Source used by build script |
|---|---|---|
| Section 1260H Chinese Military Companies | Dept. of Defense | DoD 1260H notice (PDF) |
| Section 1286 (NDAA FY2019) Named Entities | Dept. of Defense | basicresearch.defense.gov PDF |
| Entity List (Supp. No. 4 to Part 744) | Commerce / BIS | trade.gov Consolidated Screening List (CSL) download |
| Military End-User List (Supp. No. 7 to Part 744) | Commerce / BIS | CSL download |
| Denied Persons List | Commerce / BIS | CSL download |
| NS-CMIC / Annex to E.O. 14032 | Treasury / OFAC | CSL download (CMIC source) |
| ITAR Debarred Parties | State / DDTC | CSL download |
| Nonproliferation Sanctions | State / ISN | CSL download |
| Covered List (Secure Networks Act §2) | FCC | fcc.gov/supplychain/coveredlist |
| UFLPA Entity List | DHS | dhs.gov/uflpa-entity-list |
| Withhold Release Orders & Findings | CBP | cbp.gov WRO page |

Each entry: `{ name, aliases[], listId }`. Each list: `{ id, title, citation,
agency, agencyBadge, sourceUrl }`. Lists that cannot be fetched/parsed
automatically live as curated JSON under `data/manual/` with a documented
refresh procedure; the build script merges them and fails if any list is
empty. README documents how to refresh the snapshot.

## Site architecture

Static site, no framework, no build step, no keys:

- `index.html`, `css/styles.css`, `js/app.js`, `js/search.js`, `data/snapshot.json`
- `js/search.js` exports a pure `search(query, snapshot)` function
  (normalization + matching), unit-tested with Node's built-in test runner
  (`tests/search.test.js`). DOM rendering lives in `app.js`.
- Deployed via GitHub Pages from `main`.

## Search behavior

Case-insensitive whole-word/phrase matching over names and aliases with
Unicode/diacritic normalization (NFKD, strip combining marks). The query must
appear as a contiguous word sequence within a name or alias. Deterministic; no
fuzzy scoring. Empty/short queries (<2 chars) prompt for more input.

## UI

Northwestern look and feel: purple #4E2A84 header band, white content, NU-style
typography (system/Google-font approximation of Akkurat; no official logo
asset). Layout mirrors the UMD "Restricted Party Search" sample:

- Title: **Restricted Party Screener**. Small-font subtitle: "Type an entity
  or individual to check against the consolidated screening lists by US
  federal agencies. Knowledge base of this tool is based on
  https://www.nsf.gov/funding/information/dcl-prohibition-collaborations-entities-us-prohibited-party.
  Aliases are recognized." Stats line: "11 screening lists · data snapshot
  YYYY-MM-DD".
- Search box + Search button; example chips (Huawei, Beihang University, SMIC,
  ZTE, Hikvision, Harbin Institute of Technology).
- Results: summary card ("*query* — Identified in N lists: …"), then one card
  per matched list (list title, citation, agency badge, "Show matched entries
  (N)" expander revealing matched names/aliases and source link).
- No-match state explicitly worded as NOT a clearance determination.
- Footer: enumeration of included lists, snapshot date, disclaimer
  (preliminary aid, not an official determination; authoritative screening via
  Visual Compliance / Export Controls office), link + email to the NU office.

## Error handling

If `snapshot.json` fails to load, show an explicit "data failed to load — do
not treat this as a screening result" banner; the search UI is disabled.

## Testing

- Unit tests for `search()`: normalization, diacritics, alias matching,
  word-boundary behavior, multi-word phrases, known entities (e.g. "beihang"
  matches Entity List and 1286 list), no-match cases.
- Build script asserts every list is non-empty and prints per-list counts for
  manual verification against official sources.
- Manual end-to-end check on the deployed Pages URL.

## Deployment

`git init` → initial commit → push to GitHub → enable GitHub Pages (main, root)
→ verify https://dieyunsong.github.io/security-screener/.
