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

export function tokenize(s) {
  return normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// Bounded Levenshtein distance; returns Infinity once distance exceeds `max`.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return Infinity;
    prev = cur;
  }
  return prev[b.length] <= max ? prev[b.length] : Infinity;
}

// Does a query token approximately match a listed token?
// Recall-oriented but guarded for short tokens, which would otherwise flood
// results: <=3 chars exact only; 4-7 chars allow 1 edit; 8+ allow 2 edits
// (at 7 chars, 2 edits would equate e.g. "beihang" and "beijing").
// A query token of 4+ chars also matches as a prefix ("vlad" -> "vladimir").
function tokenMatches(queryTok, listedTok, fuzzy) {
  if (queryTok === listedTok) return true;
  if (!fuzzy || queryTok.length <= 3) return false;
  if (listedTok.startsWith(queryTok)) return true;
  const max = queryTok.length >= 8 ? 2 : 1;
  return editDistance(queryTok, listedTok, max) <= max;
}

// Every query token must match a DISTINCT listed token (any order).
// Backtracking assignment; token counts are small.
function tokensMatch(queryToks, listedToks, fuzzy) {
  const used = new Array(listedToks.length).fill(false);
  function assign(i) {
    if (i === queryToks.length) return true;
    for (let j = 0; j < listedToks.length; j++) {
      if (!used[j] && tokenMatches(queryToks[i], listedToks[j], fuzzy)) {
        used[j] = true;
        if (assign(i + 1)) return true;
        used[j] = false;
      }
    }
    return false;
  }
  return assign(0);
}

// Precompute normalized text and token arrays for every listed name/alias.
// Called once after the snapshot loads; search() falls back to computing
// per entry when it is not called (e.g. small fixtures in tests).
export function prepareSnapshot(snapshot) {
  for (const entry of snapshot.entries) {
    entry._targets = [entry.n, ...(entry.a || [])].map((text) => ({
      text,
      norm: normalize(text),
      toks: tokenize(text),
    }));
  }
  return snapshot;
}

function targetsOf(entry) {
  return entry._targets || [entry.n, ...(entry.a || [])].map((text) => ({
    text,
    norm: normalize(text),
    toks: tokenize(text),
  }));
}

// Match tiers, checked in order:
//   exact       - the query appears as a contiguous word/phrase
//   reordered   - every query word appears as a listed word, any order
//                 (catches "vladimir putin" vs "PUTIN, Vladimir")
//   approximate - like reordered, but tolerating prefixes and small typos
export function search(query, snapshot) {
  const q = normalize(query);
  if (q.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return [];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
  const queryToks = tokenize(query);

  const results = [];
  for (const entry of snapshot.entries) {
    const targets = targetsOf(entry);
    let match = null;
    for (const t of targets) {
      if (re.test(t.norm)) { match = { matched: t.text, matchType: "exact" }; break; }
    }
    if (!match && queryToks.length) {
      for (const t of targets) {
        if (tokensMatch(queryToks, t.toks, false)) {
          match = { matched: t.text, matchType: "reordered" };
          break;
        }
      }
    }
    if (!match && queryToks.length) {
      for (const t of targets) {
        if (tokensMatch(queryToks, t.toks, true)) {
          match = { matched: t.text, matchType: "approximate" };
          break;
        }
      }
    }
    if (match) results.push({ entry, ...match });
  }
  const rank = { exact: 0, reordered: 1, approximate: 2 };
  return results.sort((a, b) => rank[a.matchType] - rank[b.matchType]);
}
