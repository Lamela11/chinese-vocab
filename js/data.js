// data.js - the word lists: units/index.json, one units/unit-NN/words.json per unit, and My words
// (units/my-words/words.json), the words you add yourself that aren't in the book's units. The last
// copies are kept on the device, so the app opens at once and works without internet. Every start
// asks the server for index.json (past the browser's cache), so a new unit shows up right away.

import * as store from "./store.js";

const MINE = "mine"; // what My words are saved under, next to the unit numbers
const units = new Map(); // unit number -> { unit, title, en, version, words }
let mine = null; // My words: { unit: "mine", title, en, version, words }, once there are some

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
  if (unit.unit === MINE) mine = unit;
  else units.set(unit.unit, unit);
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
  // My words have their own line in index.json ("mine"), so a copy of the app from before them
  // doesn't take them for a unit.
  const own = index.mine;
  if (own && mine?.version !== own.version) {
    try {
      const response = await fetch(`${own.file}?v=${own.version}`, { cache: "no-cache" });
      if (response.ok) {
        const list = { ...(await response.json()), unit: MINE, version: own.version };
        await store.put("units", list);
        prepare(list);
        changed = true;
      }
    } catch {
      // try again next time
    }
  } else if (!own && mine) {
    mine = null;
    await store.remove("units", MINE);
    changed = true;
  }
  return changed;
}

export const unitList = () => [...units.values()].sort((a, b) => a.unit - b.unit);
export const unit = (number) => units.get(number);
export const myWords = () => mine;
// Every word: the units' first, so a word that's also in a unit is shown as the book gives it.
export const allWords = () => [...unitList(), ...(mine ? [mine] : [])].flatMap((u) => u.words);
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
