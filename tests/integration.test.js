import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { search } from "../js/search.js";

const snapshot = JSON.parse(readFileSync(new URL("../data/snapshot.json", import.meta.url)));

function listsFor(query) {
  return [...new Set(search(query, snapshot).map((r) => r.entry.l))].sort();
}

test("snapshot has all 14 lists and no empty list", () => {
  assert.equal(snapshot.lists.length, 14);
  for (const list of snapshot.lists) {
    assert.ok(list.count > 0, `${list.id} is empty`);
  }
});

test("every entry references a known list", () => {
  const ids = new Set(snapshot.lists.map((l) => l.id));
  for (const entry of snapshot.entries) {
    assert.ok(ids.has(entry.l), `unknown list ${entry.l}`);
  }
});

test("beihang is identified on the Entity List and the 1286 list", () => {
  const lists = listsFor("beihang");
  assert.ok(lists.includes("el"));
  assert.ok(lists.includes("1286"));
});

test("huawei is identified on Entity List, 1260H, FCC Covered List and Section 889", () => {
  const lists = listsFor("huawei");
  for (const id of ["el", "1260h", "fcc", "889"]) {
    assert.ok(lists.includes(id), `huawei missing from ${id}`);
  }
});

test("smic is identified on the Section 5949 semiconductor list", () => {
  assert.ok(listsFor("smic").includes("5949"));
});

test("SDN entries are searchable", () => {
  assert.ok(listsFor("islamic revolutionary guard corps").includes("sdn"));
});

test("batch example resolves each party independently", () => {
  const queries = ["SABA AMBAYE", "huawei", "MARCEL LEFEBVRE"];
  const hits = queries.map((q) => listsFor(q));
  assert.ok(hits[0].includes("dpl"));
  assert.ok(hits[1].includes("el"));
  assert.ok(hits[2].includes("dpl"));
});

test("thousand talents plan is identified on the 1286 list", () => {
  assert.deepEqual(listsFor("thousand talents plan"), ["1286"]);
});

test("an unlisted name returns no matches", () => {
  assert.equal(search("evanston lakefill bakery", snapshot).length, 0);
});

// Recall guard: "northwestern university" must surface Northwestern
// POLYTECHNICAL University (Xi'an, PRC — Entity List / 1286), a nearby
// name a screener could otherwise be falsely reassured about.
test("northwestern university surfaces Northwestern Polytechnical University", () => {
  const lists = listsFor("northwestern university");
  assert.ok(lists.includes("el"));
  assert.ok(lists.includes("1286"));
});

test("vladimir putin is found on the SDN list despite flipped name order", () => {
  assert.ok(listsFor("vladimir putin").includes("sdn"));
  assert.ok(listsFor("vlad putin").includes("sdn"));
});
