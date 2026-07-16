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

// Split a batch input ("SABA AMBAYE, huawei, MARCEL LEFEBVRE") into
// individual queries. Delimiters: commas, semicolons, newlines. A segment
// that is only a corporate suffix ("Ltd.") is re-attached to the previous
// segment so "Huawei Technologies Co., Ltd." stays one query.
const CORPORATE_SUFFIX = /^(?:ltd|llc|l\.l\.c|inc|co|corp|company|limited|plc|gmbh|s\.a|sa)\.?$/i;

export function parseQueries(input) {
  const queries = [];
  const seen = new Set();
  for (const segment of input.split(/[,;\n]+/)) {
    const part = segment.trim();
    if (!part) continue;
    if (queries.length && CORPORATE_SUFFIX.test(part)) {
      const merged = `${queries[queries.length - 1]}, ${part}`;
      seen.delete(normalize(queries[queries.length - 1]));
      if (seen.has(normalize(merged))) {
        queries.pop();
      } else {
        seen.add(normalize(merged));
        queries[queries.length - 1] = merged;
      }
      continue;
    }
    const key = normalize(part);
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(part);
  }
  return queries;
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
