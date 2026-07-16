// Pure search logic for the Restricted Party Screener.
//
// Matching rule (deterministic, no fuzzy scoring): the normalized query must
// appear as a whole word/phrase — bounded by non-alphanumeric characters —
// inside a listed name or alias. Normalization is case-, diacritic-, and
// whitespace-insensitive.

export function normalize(s) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining marks left by NFKD
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function search(query, snapshot) {
  const q = normalize(query);
  if (q.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return [];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");

  const results = [];
  for (const entry of snapshot.entries) {
    if (re.test(normalize(entry.n))) {
      results.push({ entry, matched: entry.n });
      continue;
    }
    const alias = (entry.a || []).find((a) => re.test(normalize(a)));
    if (alias !== undefined) {
      results.push({ entry, matched: alias });
    }
  }
  return results;
}
