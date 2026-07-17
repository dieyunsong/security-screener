import test from "node:test";
import assert from "node:assert/strict";
import { normalize, search } from "../js/search.js";

const snapshot = {
  entries: [
    { n: "Beihang University", a: ["Beijing University of Aeronautics and Astronautics"], l: "el" },
    { n: "Beihang University", a: [], l: "1286" },
    { n: "Harbin Institute of Technology", a: [], l: "el" },
    { n: "Huawei Technologies Co., Ltd.", a: ["Huawei"], l: "el" },
    { n: "Université Libre de Test", a: [], l: "isn" },
    { n: "Xi'an Aircraft Industry Group Company Ltd.", a: [], l: "1260h" },
    { n: "Zhongji Innolight Co., Ltd.", a: ["Innolight"], l: "1260h" },
    { n: "PUTIN, Vladimir Vladimirovich", a: ["PUTIN, Vladimir"], l: "sdn" },
    { n: "LIN, Wei", a: [], l: "sdn" },
  ],
};

test("normalize lowercases and strips diacritics", () => {
  assert.equal(normalize("Université"), "universite");
});

test("normalize converts curly apostrophes to straight", () => {
  assert.equal(normalize("Xi’an"), "xi'an");
});

test("normalize collapses whitespace", () => {
  assert.equal(normalize("  Beihang \n University "), "beihang university");
});

test("matches a name case-insensitively", () => {
  const results = search("BEIHANG UNIVERSITY", snapshot);
  assert.ok(results.some((r) => r.entry.n === "Beihang University" && r.entry.l === "el"));
});

test("returns one result per listed entry (same name on two lists)", () => {
  const results = search("beihang", snapshot);
  const lists = results.map((r) => r.entry.l).sort();
  assert.deepEqual(lists, ["1286", "el"]);
});

test("matches inside a name at word boundaries", () => {
  const results = search("beihang", snapshot);
  assert.ok(results.length > 0);
});

test("does not match unrelated partial words", () => {
  assert.equal(search("hang", snapshot).length, 0);
});

test("single-word typo matches approximately", () => {
  const results = search("niversity", snapshot); // typo of "university"
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.matchType === "approximate"));
});

test("matches aliases and reports the matched text", () => {
  const results = search("innolight", snapshot);
  assert.equal(results.length, 1);
  assert.equal(results[0].entry.n, "Zhongji Innolight Co., Ltd.");
});

test("alias-only query reports alias as matched text", () => {
  const results = search("beijing university of aeronautics", snapshot);
  assert.equal(results.length, 1);
  assert.equal(results[0].matched, "Beijing University of Aeronautics and Astronautics");
});

test("multi-word phrase matches across the name", () => {
  const results = search("harbin institute", snapshot);
  assert.equal(results.length, 1);
  assert.equal(results[0].entry.n, "Harbin Institute of Technology");
});

test("out-of-order words match as a reordered token match", () => {
  const results = search("institute harbin", snapshot);
  assert.equal(results.length, 1);
  assert.equal(results[0].entry.n, "Harbin Institute of Technology");
  assert.equal(results[0].matchType, "reordered");
});

test("query with diacritics matches plain target and vice versa", () => {
  assert.equal(search("université libre", snapshot).length, 1);
  assert.equal(search("universite libre", snapshot).length, 1);
});

test("curly apostrophe in query matches straight apostrophe in name", () => {
  assert.equal(search("xi’an aircraft", snapshot).length, 1);
});

test("punctuation in the target does not block phrase matching", () => {
  assert.equal(search("huawei technologies co", snapshot).length, 1);
});

test("queries shorter than 2 characters return nothing", () => {
  assert.equal(search("h", snapshot).length, 0);
  assert.equal(search("", snapshot).length, 0);
  assert.equal(search("   ", snapshot).length, 0);
});

test("regex metacharacters in query do not crash and match literally", () => {
  const results = search("co. (ltd)", snapshot); // matches entries with 'co' and 'ltd' tokens
  assert.ok(results.every((r) => ["exact", "reordered"].includes(r.matchType)));
  assert.equal(search("xi'an aircraft industry group company ltd.", snapshot).length, 1);
});

// --- recall-oriented name matching ---

test("flipped first/last name matches a comma-formatted listed name", () => {
  const results = search("vladimir putin", snapshot);
  assert.equal(results.length, 1);
  assert.equal(results[0].entry.n, "PUTIN, Vladimir Vladimirovich");
  assert.equal(results[0].matchType, "reordered");
});

test("listed-name order with punctuation also matches", () => {
  assert.equal(search("putin, vladimir", snapshot).length, 1);
  assert.equal(search("putin vladimir", snapshot).length, 1);
});

test("shortened given name matches by prefix", () => {
  const results = search("vlad putin", snapshot);
  assert.equal(results.length, 1);
  assert.equal(results[0].matchType, "approximate");
});

test("typo in a name still matches", () => {
  assert.equal(search("vladmir putin", snapshot).length, 1);  // dropped letter
  assert.equal(search("vladimir puttin", snapshot).length, 1); // doubled letter
});

test("very short tokens do not fuzzy-match different short tokens", () => {
  // "li" must not match "LIN, Wei" (would flood results)
  assert.equal(search("li wei", snapshot).length, 0);
});

test("all query tokens must find a distinct listed token", () => {
  assert.equal(search("vladimir aircraft", snapshot).length, 0);
});

test("exact phrase matches keep matchType exact", () => {
  const results = search("beihang university", snapshot);
  assert.ok(results.every((r) => r.matchType === "exact"));
});

test("each entry appears at most once even if name and alias both match", () => {
  const results = search("huawei", snapshot);
  assert.equal(results.length, 1);
});

// --- batch parsing ---

import { parseQueries } from "../js/search.js";

test("parseQueries splits on commas and trims", () => {
  assert.deepEqual(parseQueries("SABA AMBAYE, huawei, MARCEL LEFEBVRE"),
    ["SABA AMBAYE", "huawei", "MARCEL LEFEBVRE"]);
});

test("parseQueries splits on semicolons and newlines", () => {
  assert.deepEqual(parseQueries("Beihang University; ZTE\nHikvision"),
    ["Beihang University", "ZTE", "Hikvision"]);
});

test("parseQueries keeps corporate suffixes attached (Co., Ltd.)", () => {
  assert.deepEqual(parseQueries("Huawei Technologies Co., Ltd., SMIC"),
    ["Huawei Technologies Co., Ltd.", "SMIC"]);
});

test("parseQueries drops empties and dedupes case-insensitively", () => {
  assert.deepEqual(parseQueries(" huawei ,, HUAWEI , zte "), ["huawei", "zte"]);
});

test("parseQueries returns single-item array for a plain query", () => {
  assert.deepEqual(parseQueries("Beihang University"), ["Beihang University"]);
});

test("parseQueries returns empty array for blank input", () => {
  assert.deepEqual(parseQueries("  "), []);
});
