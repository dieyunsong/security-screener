import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { search } from "../js/search.js";

const snapshot = JSON.parse(readFileSync(new URL("../data/snapshot.json", import.meta.url)));

function listsFor(query) {
  return [...new Set(search(query, snapshot).map((r) => r.entry.l))].sort();
}

test("snapshot has all 11 lists and no empty list", () => {
  assert.equal(snapshot.lists.length, 11);
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

test("huawei is identified on Entity List, 1260H and FCC Covered List", () => {
  const lists = listsFor("huawei");
  for (const id of ["el", "1260h", "fcc"]) {
    assert.ok(lists.includes(id), `huawei missing from ${id}`);
  }
});

test("thousand talents plan is identified on the 1286 list", () => {
  assert.deepEqual(listsFor("thousand talents plan"), ["1286"]);
});

test("an unlisted name returns no matches", () => {
  assert.equal(search("northwestern university", snapshot).length, 0);
});
