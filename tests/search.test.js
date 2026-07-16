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

test("does not match partial words", () => {
  assert.equal(search("hang", snapshot).length, 0);
  assert.equal(search("niversity", snapshot).length, 0);
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

test("out-of-order words do not match (phrase matching)", () => {
  assert.equal(search("institute harbin", snapshot).length, 0);
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

test("regex metacharacters in query are treated literally", () => {
  assert.equal(search("co. (ltd)", snapshot).length, 0); // no crash, no match
  assert.equal(search("xi'an aircraft industry group company ltd.", snapshot).length, 1);
});

test("each entry appears at most once even if name and alias both match", () => {
  const results = search("huawei", snapshot);
  assert.equal(results.length, 1);
});
