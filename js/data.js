// data.js - the word lists: units/index.json and one units/unit-NN/words.json per unit. The last
// copies are kept on the device, so the app opens at once and works without internet. Every start
// asks the server for index.json (past the browser's cache), so a new unit shows up right away.

import * as store from "./store.js";

const units = new Map(); // unit number -> { unit, title, en, version, words }

// The key that progress and stars are kept under: the same word in two units (老师 in Units 1
// and 3) shares one history. "需要|xūyào"
export function wordKey(word) {
  const main = word.pinyin.replace(/\s*\(.*?\)/g, "");
  return `${word.hanzi}|${main.normalize("NFC").toLowerCase().replace(/[\s'’-]/g, "")}`;
}

function prepare(unit) {
  for (const word of unit.words) {
    word.unit = unit.unit;
    word.key = wordKey(word);
  }
  units.set(unit.unit, unit);
}

export async function loadSaved() {
  for (const unit of await store.getAll("units")) prepare(unit);
}

// Download new or changed units. Returns true when something changed.
export async function refresh() {
  let index;
  try {
    const response = await fetch("units/index.json", { cache: "no-cache" });
    if (!response.ok) return false;
    index = await response.json();
  } catch {
    return false; // offline: keep using the saved lists
  }
  let changed = false;
  for (const entry of index.units) {
    if (units.get(entry.unit)?.version === entry.version) continue;
    try {
      const response = await fetch(`${entry.file}?v=${entry.version}`, { cache: "no-cache" });
      if (!response.ok) continue;
      const unit = { ...(await response.json()), version: entry.version };
      await store.put("units", unit);
      prepare(unit);
      changed = true;
    } catch {
      // try again next time
    }
  }
  for (const number of [...units.keys()]) {
    if (!index.units.some((entry) => entry.unit === number)) {
      units.delete(number);
      await store.remove("units", number);
      changed = true;
    }
  }
  return changed;
}

export const unitList = () => [...units.values()].sort((a, b) => a.unit - b.unit);
export const unit = (number) => units.get(number);
export const allWords = () => unitList().flatMap((u) => u.words);
export const byKey = (key) => allWords().find((w) => w.key === key);
export const isPerson = (word) => word.tag === "name" && !!word.person;

export function dedupe(words) {
  const seen = new Set();
  return words.filter((w) => !seen.has(w.key) && seen.add(w.key));
}

// Stars from the study log's "keep forgetting" lists (tools/study_log.py). Until sync is set up
// they come from local/brain.json on this laptop; elsewhere the file doesn't exist.
export async function brainEvents() {
  try {
    const response = await fetch("local/brain.json", { cache: "no-cache" });
    return response.ok ? (await response.json()).events : [];
  } catch {
    return [];
  }
}
