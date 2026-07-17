import { normalize, parseQueries, prepareSnapshot, search } from "./search.js";

const EXAMPLES = ["Huawei", "Beihang University", "SMIC", "ZTE", "Hikvision",
  "Harbin Institute of Technology"];

const el = {
  form: document.getElementById("search-form"),
  query: document.getElementById("query"),
  btn: document.getElementById("search-btn"),
  chips: document.getElementById("chips"),
  results: document.getElementById("results"),
  stats: document.getElementById("stats"),
  loadError: document.getElementById("load-error"),
  footerLists: document.getElementById("footer-lists"),
  snapshotNote: document.getElementById("snapshot-note"),
};

let snapshot = null;

function esc(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Highlight the parts of `text` whose normalized form contains the query.
function highlight(text, query) {
  const q = normalize(query);
  const words = q.split(" ").filter(Boolean);
  if (!words.length) return esc(text);
  let out = esc(text);
  // Highlight each query word where it appears as a whole word (best effort,
  // display-only; matching itself is done in search.js).
  for (const w of new Set(words)) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`, "giu"),
      "<mark>$1</mark>");
  }
  return out;
}

function renderChips() {
  el.chips.innerHTML = EXAMPLES.map((x) =>
    `<button type="button" class="chip" role="listitem">${esc(x)}</button>`).join("");
  for (const btn of el.chips.querySelectorAll(".chip")) {
    btn.addEventListener("click", () => {
      el.query.value = btn.textContent;
      runSearch();
    });
  }
}

function renderFooter() {
  el.footerLists.innerHTML = snapshot.lists.map((l) =>
    `<li><a href="${esc(l.url)}">${esc(l.title)}</a> &mdash; ${esc(l.agency)} (${l.count} entries)</li>`
  ).join("");
  el.snapshotNote.innerHTML =
    `Data snapshot: <strong>${esc(snapshot.built)}</strong>. Basis: Appendix A of the ` +
    `<a href="${esc(snapshot.basisUrl)}">NSF Dear Colleague Letter on prohibited-party collaborations</a> ` +
    `and <a href="https://basicresearch.defense.gov/Portals/61/Documents/Academic%20Research%20Security%20Page/2026%20DoW%20Component%20Decision%20Matrix%20to%20Inform%20Fundamental%20Research%20Proposal%20Mitigation%20Decisions.pdf?ver=uf_txB5YT_N7ewpWfbpO5w%3d%3d">DoD's prohibited entity lists</a>.`;
}

function renderStats() {
  el.stats.innerHTML =
    `<span>${snapshot.lists.length} screening lists</span> &middot; ` +
    `<span>${snapshot.entries.length.toLocaleString()} entries</span> &middot; ` +
    `<span>data snapshot ${esc(snapshot.built)}</span>`;
  el.stats.hidden = false;
}

const MAX_ROWS_PER_LIST = 200;

function buildResultBlock(query, results) {
  const byList = new Map();
  for (const r of results) {
    if (!byList.has(r.entry.l)) byList.set(r.entry.l, []);
    byList.get(r.entry.l).push(r);
  }
  const listsHit = snapshot.lists.filter((l) => byList.has(l.id));

  if (!listsHit.length) {
    return `
      <div class="summary clear">
        <h2><span class="q">${esc(query)}</span> &mdash; no matches in the ${snapshot.lists.length} lists in this tool</h2>
        <p>This is <strong>not</strong> a clearance determination. It means only that the search
        phrase did not match a listed name or alias in this tool&rsquo;s data snapshot
        (${esc(snapshot.built)}). Spelling variants or newer designations may not be captured.
        For authoritative screening, contact
        <a href="mailto:exportcontrols@northwestern.edu">exportcontrols@northwestern.edu</a>.</p>
      </div>`;
  }

  // A list is a "firm" hit when it has at least one exact or reordered
  // match; lists reached only through typo/prefix tolerance are reported
  // separately so approximate noise never buries a firm hit.
  const isFirm = (l) => byList.get(l.id).some((r) => r.matchType !== "approximate");
  const firm = listsHit.filter(isFirm);
  const approxOnly = listsHit.filter((l) => !isFirm(l));

  const headline = firm.length
    ? `identified in ${firm.length} ${firm.length === 1 ? "list" : "lists"}:
       ${firm.map((l) => esc(l.title)).join("; ")}`
    : `possible (approximate) matches in ${approxOnly.length}
       ${approxOnly.length === 1 ? "list" : "lists"}`;
  const approxNote = firm.length && approxOnly.length
    ? ` Additional approximate matches appear in ${approxOnly.length} more
       ${approxOnly.length === 1 ? "list" : "lists"} below.` : "";

  const summary = `
    <div class="summary hit">
      <h2><span class="q">${esc(query)}</span> &mdash; ${headline}</h2>
      <p>Results reflect only the source tables in this tool. Matches may be on the listed name
      or on an associated alias; approximate matches (reversed word order, shortened forms,
      small typos) are labeled.${approxNote} A match indicates a potential restricted party &mdash;
      contact the <a href="https://exports.northwestern.edu/contact.html">Export
      Controls &amp; International Compliance office</a> before proceeding.</p>
    </div>`;

  const cards = [...firm, ...approxOnly].map((l) => {
    const all = byList.get(l.id);
    const shown = all.slice(0, MAX_ROWS_PER_LIST);
    const rows = shown.map((r) => {
      const viaAlias = r.matched !== r.entry.n;
      return `<li>
        <span class="matched-name">${highlight(r.entry.n, query)}</span>
        ${r.matchType === "approximate" ? `<span class="tag-approx">approximate</span>` : ""}
        ${viaAlias ? `<span class="via-alias"> &mdash; matched alias: ${highlight(r.matched, query)}</span>` : ""}
        ${r.entry.note ? `<div class="entry-note">${esc(r.entry.note)}</div>` : ""}
      </li>`;
    }).join("");
    const capNote = all.length > shown.length
      ? `<p class="entry-note">Showing the first ${MAX_ROWS_PER_LIST} of ${all.length} matches
         &mdash; refine the search to narrow results.</p>` : "";
    return `
      <div class="list-card${isFirm(l) ? "" : " approx"}">
        <span class="badge">${esc(l.badge)}</span>
        <h3>${esc(l.title)}</h3>
        <p class="citation">${esc(l.citation)} &mdash; ${esc(l.agency)}</p>
        <details>
          <summary>Show matched entries (${all.length})${isFirm(l) ? "" : " — approximate only"}</summary>
          <ul>${rows}</ul>
          ${capNote}
        </details>
      </div>`;
  }).join("");

  return summary + cards;
}

function runSearch() {
  if (!snapshot) return;
  const queries = parseQueries(el.query.value).filter(
    (q) => normalize(q).replace(/[^\p{L}\p{N}]/gu, "").length >= 2);
  if (!queries.length) {
    el.results.innerHTML = `
      <div class="summary">
        <p>Enter at least two characters of an entity or individual name.
        Separate multiple parties with commas to screen them in one batch.</p>
      </div>`;
    return;
  }

  if (queries.length === 1) {
    el.results.innerHTML = buildResultBlock(queries[0], search(queries[0], snapshot));
    return;
  }

  const blocks = queries.map((q) => ({ q, results: search(q, snapshot) }));
  const flagged = blocks.filter((b) => b.results.length).length;
  el.results.innerHTML = `
    <div class="batch-overview ${flagged ? "hit" : "clear"}">
      <strong>Batch screening:</strong> ${queries.length} parties checked &mdash;
      ${flagged ? `${flagged} with potential matches` : "no potential matches"}
    </div>` +
    blocks.map(({ q, results }) => `
      <section class="batch-block">
        <h2 class="batch-name">${esc(q)}</h2>
        ${buildResultBlock(q, results)}
      </section>`).join("");
}

async function init() {
  renderChips();
  try {
    const resp = await fetch("data/snapshot.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    snapshot = prepareSnapshot(await resp.json());
  } catch (err) {
    el.loadError.hidden = false;
    return;
  }
  renderStats();
  renderFooter();
  el.query.disabled = false;
  el.btn.disabled = false;
  const preset = new URLSearchParams(location.search).get("q");
  if (preset) {
    el.query.value = preset;
    runSearch();
  } else {
    el.query.focus();
  }
}

el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch();
});

init();
