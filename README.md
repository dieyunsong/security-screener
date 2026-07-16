# Restricted Party Screener

A static, self-contained web tool that lets Northwestern faculty and staff who
receive federal funding take a **preliminary** look at whether a collaborator
(entity or individual) appears on the U.S. federal restricted party lists
enumerated in **Appendix A** of the NSF Dear Colleague Letter
[*Prohibition on Collaborations with Entities on a U.S. Prohibited Party List*](https://www.nsf.gov/funding/information/dcl-prohibition-collaborations-entities-us-prohibited-party).

**Live site:** https://dieyunsong.github.io/security-screener/

> **Disclaimer.** This is an informal pre-screening aid, **not** an official
> Northwestern University Export Controls determination, and a "no match"
> result is **not** a clearance. For authoritative screening (performed with
> Visual Compliance), contact the
> [Export Controls & International Compliance office](https://exports.northwestern.edu/federal-regulations/restricted-party-screenings.html)
> at <exportcontrols@northwestern.edu>.

## Lists included (11)

| List | Agency |
|---|---|
| Section 1260H Chinese Military Companies List | Dept. of Defense |
| Section 1286 List (institutions & foreign talent programs) | Dept. of Defense |
| Entity List (Supp. No. 4 to 15 CFR Part 744) | Commerce / BIS |
| Military End-User (MEU) List (Supp. No. 7 to Part 744) | Commerce / BIS |
| Denied Persons List | Commerce / BIS |
| Non-SDN Chinese Military-Industrial Complex Companies (Annex to E.O. 14032) | Treasury / OFAC |
| ITAR Debarred Parties List | State / DDTC |
| Nonproliferation Sanctions | State / ISN |
| Covered List (Secure and Trusted Communications Networks Act) | FCC |
| UFLPA Entity List | DHS |
| Withhold Release Orders & Findings (active) | CBP |

## How it works

- `data/snapshot.json` — a point-in-time compilation of the lists above,
  built by `scripts/build_snapshot.py`. The snapshot date is shown in the UI.
- `js/search.js` — pure matching logic: case-, diacritic-, and
  whitespace-insensitive whole word/phrase matching over listed names and
  aliases. No fuzzy scoring; every match is explainable.
- `js/app.js` + `index.html` + `css/styles.css` — static UI, no framework,
  no build step, no external services.

## Refreshing the data snapshot

The federal lists change throughout the year. To refresh:

```bash
python3 -m venv .venv
.venv/bin/pip install pypdf
.venv/bin/python scripts/build_snapshot.py --refresh
npm test   # verify parsing and search still behave
```

Then review the printed per-list counts against the official sources, and
commit the updated `data/snapshot.json`.

Notes on sources:

- The six BIS/OFAC/State lists come from the official
  [Consolidated Screening List download](https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.csv).
- The DoD 1260H list is parsed from its Federal Register notice text
  (currently 91 FR 35189). When DoD publishes a new designation, update the
  `1260h_fr.txt` URL in `SOURCES` to the new notice's raw-text URL.
- defense.gov and fcc.gov block non-browser clients, so the Section 1286 PDF
  and FCC Covered List are fetched through the Internet Archive's copy of the
  identical official documents. Update those URLs when new versions publish.
- The CBP WRO CSV link is discovered automatically from CBP's document page.

## Tests

```bash
npm test
```

Unit tests cover normalization and matching behavior; integration tests
verify known entities (e.g., Beihang University → Entity List + Section 1286
list) against the real snapshot.
