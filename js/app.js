// app.js - the screens: home (Review, Hard words, the units and My words), a page for each list of
// words (a unit, My words, Review, Hard words or several units mixed) with its words and the three
// ways to study it, the study screens of study.js, and Sync. Every answer, star and setting is saved
// as an event on this device (store.js) and shared with your other devices (sync.js); progress is
// worked out from all the events together (srs.js).

import * as data from "./data.js";
import { qrSvg } from "./qrcode.js";
import * as speech from "./speech.js";
import * as srs from "./srs.js";
import * as store from "./store.js";
import { study } from "./study.js";
import * as sync from "./sync.js";
import { esc, icon, shuffle, wordRow } from "./ui.js";

const screen = document.getElementById("screen");
const events = []; // the events on this device: its own and those synced from the others
const ids = new Set(); // their ids
let brain = []; // stars from the study log, read from local/brain.json (data.brainEvents)
let st = srs.derive([]);
let saving = Promise.resolve();
let shown = null; // the address on screen
let close = null; // tidies up after a study screen
let keeps = true; // false if this browser won't keep what's saved (some private windows)
let link = null; // this device's sync setup (sync.connect), kept in store "kv" as "sync"
let syncing = null; // the sync under way
let syncAgain = false; // another sync was asked for during it
let syncNote = ""; // what the Sync screen says about connecting
let showCode = false; // the Sync screen shows the code for the phone

const DEFAULTS = { mode: "card", front: "hanzi", order: "book", quiz: "hanzi-en", type: "pinyin", people: false, mixOff: [] };
const setting = (name) => st.settings[name] ?? DEFAULTS[name];
const today = () => srs.dayOf(Date.now());
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const zh = (text) => `<span lang="zh-CN">${text}</span>`;

const MODES = [["card", "Flashcards"], ["quiz", "Quiz"], ["type", "Type"]];
const OPTIONS = {
  card: [
    ["front", "Front", [["hanzi", zh("汉字")], ["pinyin", "Pinyin"], ["en", "English"]]],
    ["order", "Order", [["book", "In order"], ["shuffle", "Shuffled"]]],
  ],
  quiz: [["quiz", "", [["hanzi-en", `${zh("汉字")} → meaning`], ["pinyin-hanzi", `Pinyin → ${zh("汉字")}`],
    ["en-hanzi", `English → ${zh("汉字")}`]]]],
  type: [["type", "Answer", [["pinyin", "Pinyin"], ["meaning", "Meaning"]]]],
};

// --- Saving -------------------------------------------------------------------------------------

// All the events, each once (the study log's stars can come both from the file and from a sync).
const progress = () => srs.derive([...new Map([...events, ...brain].map((e) => [e.id, e])).values()]);

// Save an event and add it to the progress. Saves go one after another, in the order they're made.
function save(fields) {
  const saved = saving.then(async () => {
    const event = await store.record(fields);
    events.push(event);
    ids.add(event.id);
    srs.apply(st, event);
    return event;
  });
  saving = saved.catch((error) => console.error("Couldn't save", fields, error));
  return saved;
}

const set = (name, value) => save({ type: "set", name, value });

async function toggleStar(key) {
  const word = data.byKey(key);
  if (!word) return;
  const on = !srs.starred(st, word);
  for (const button of screen.querySelectorAll(`[data-star="${CSS.escape(key)}"]`)) {
    button.setAttribute("aria-pressed", on);
  }
  await save({ type: "s", k: key, on: on ? 1 : 0 });
}

// --- Sync -----------------------------------------------------------------------------------------

// "at 14:32", or "on 28 Oct at 14:32" for another day
function when(t) {
  const time = new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return srs.dayOf(t) === today() ? `at ${time}` : `on ${new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at ${time}`;
}

function syncStatus() {
  if (!link) return "Sync with your phone";
  if (syncing) return "Syncing…";
  const last = link.last ? `. Last synced ${when(link.last)}` : "";
  if (link.error?.kind === "offline") return `Not synced: no connection${last}`;
  if (link.error?.kind === "other") return `Not synced: GitHub had a problem${last}`;
  if (link.error) return "Sync stopped. Open Sync to see why.";
  return link.last ? `Synced ${when(link.last)}` : "Not synced yet";
}

function showSyncStatus() {
  const line = screen.querySelector("[data-sync-status]");
  if (line) line.textContent = syncStatus();
}

// Send this device's new events and fetch the other devices', one sync at a time: one asked for
// while another runs comes right after it.
function runSync() {
  if (!link) return Promise.resolve();
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  const started = link;
  syncing = (async () => {
    let changed = false;
    try {
      await saving;
      const { read, seen } = await sync.sync(started, await store.deviceId(), events, brain);
      for (const event of read) {
        if (ids.has(event.id)) continue;
        ids.add(event.id);
        events.push(event);
        await store.put("events", event);
        changed = true;
      }
      if (link === started) link = { ...started, seen, last: Date.now(), error: null };
    } catch (error) {
      if (!(error instanceof sync.SyncError)) console.error(error);
      if (link === started) link = { ...started, error: { kind: error.kind ?? "other", message: error.message } };
    }
    if (link && link.token === started.token) await store.put("kv", link, "sync");
    if (changed) st = progress();
    syncing = null;
    if (!studying() && (changed || ["", "sync"].includes(where().kind))) render(true);
    else showSyncStatus();
    if (syncAgain) {
      syncAgain = false;
      runSync();
    }
  })();
  showSyncStatus();
  return syncing;
}

async function connect(token) {
  syncNote = "Checking the key…";
  if (where().kind === "sync") render(true);
  try {
    const api = await store.get("kv", "api"); // only set when testing with a stand-in for GitHub
    link = await sync.connect(token, api || undefined);
    await store.put("kv", link, "sync");
    syncNote = "";
    await runSync();
  } catch (error) {
    syncNote = error.message;
  }
  if (where().kind === "sync") render(true);
}

async function disconnect() {
  if (!confirm("Stop syncing this device? Its progress stays here, and you'll need the key (or the code on another device) to connect it again.")) return;
  link = null;
  showCode = false;
  await store.remove("kv", "sync");
  render(true);
}

function syncPage() {
  const intro = `<p class="muted">Keeps your progress the same on your phone and laptop. It's kept in a private
    repository on your GitHub, chinese-vocab-progress, that only you can open.</p>`;
  const body = !link ? `
    <form class="connect" data-connect>
      <label for="key">Key from GitHub</label>
      <input class="field" id="key" name="key" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
      <button class="wide primary">Connect</button>
      ${syncNote ? `<p class="${syncNote.endsWith("…") ? "muted" : "error"}">${esc(syncNote)}</p>` : ""}
    </form>` : `
    <section class="sync-box">
      <p>Connected to ${esc(link.owner)}/chinese-vocab-progress.</p>
      <p class="muted" data-sync-status>${esc(syncStatus())}</p>
      ${link.error && link.error.kind !== "offline" ? `<p class="error">${esc(link.error.message)}</p>` : ""}
      <button class="wide" data-sync-now>Sync now</button>
    </section>
    <section class="sync-box">
      <h2>Your phone</h2>
      <p class="muted">Scan the code with your phone's camera. It opens the app on the phone and connects it.
        Use the camera, not WeChat, and don't share a photo of the code: it holds your key.</p>
      ${showCode ? `<div class="qr-box">${qrSvg(`${sync.onlineAddress(link)}#connect=${link.token}`)}</div>`
        : '<button class="wide" data-show-code>Show the code</button>'}
    </section>
    <button class="link" data-disconnect>Stop syncing this device</button>`;
  screen.innerHTML = `
    <header class="bar"><button class="icon" data-back aria-label="Back" title="Back">${icon.back}</button></header>
    <div class="deck-head"><h1>Sync</h1>${intro}</div>
    ${body}`;
}

// --- Lists of words -------------------------------------------------------------------------------

// The words you study from a list: people's names only if you turned them on, each word once.
const studied = (words) => data.dedupe(words.filter((w) => setting("people") || !data.isPerson(w)));
// Every entry once, for showing: a word goes before a person's name it shares a key with (李 is both).
const once = (words) => data.dedupe([...words.filter((w) => !data.isPerson(w)), ...words.filter(data.isPerson)]);
const known = (words) => words.filter((w) => srs.known(st, w.key)).length;

function mixedUnits() {
  const off = setting("mixOff");
  return data.unitList().filter((u) => !off.includes(u.unit));
}

// [1, 2, 3, 5] -> "1–3, 5"
function ranges(numbers) {
  const runs = [];
  for (const n of numbers) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
}

// A list to show and study: list is every entry to show, words the ones to study.
function deck({ kind, number }) {
  if (kind === "unit") {
    const unit = data.unit(number);
    if (!unit) return null;
    return { kind, path: `#/unit/${number}`, label: `Unit ${number}`, unit, list: unit.words, words: studied(unit.words) };
  }
  if (kind === "mine") {
    const own = data.myWords();
    if (!own) return null;
    return { kind, path: "#/mine", label: own.en, own, list: own.words, words: studied(own.words) };
  }
  const all = data.allWords();
  if (kind === "review") {
    const words = studied(all).filter((w) => srs.due(st, w.key, today()));
    return { kind, path: "#/review", label: "Review", list: words, words };
  }
  if (kind === "hard") {
    const hard = all.filter((w) => srs.hard(st, w));
    return { kind, path: "#/hard", label: "Hard words", list: once(hard), words: studied(hard) };
  }
  if (kind === "mix") {
    const entries = mixedUnits().flatMap((u) => u.words);
    return { kind, path: "#/mix", label: "Mix units", list: once(entries), words: studied(entries) };
  }
  return null;
}

// --- Screens ------------------------------------------------------------------------------------

function home() {
  const all = studied(data.allWords());
  const due = all.filter((w) => srs.due(st, w.key, today())).length;
  const hard = all.filter((w) => srs.hard(st, w)).length;
  const units = data.unitList();
  const own = data.myWords();
  const mixed = mixedUnits();
  const mixWords = studied(mixed.flatMap((u) => u.words));
  const which = mixed.length === units.length ? "All units"
    : mixed.length ? `Unit${mixed.length > 1 ? "s" : ""} ${ranges(mixed.map((u) => u.unit))}` : "No units chosen";
  const tile = (path, title, text, on) => on
    ? `<a class="tile" href="${path}" data-link><strong>${title}</strong><span class="accent">${text}</span></a>`
    : `<div class="tile off"><strong>${title}</strong><span>${text}</span></div>`;
  const row = (path, title, sub, lang = "") => `
    <a class="row" href="${path}" data-link>
      <span class="row-text"><span class="row-title"${lang}>${esc(title)}</span><span class="row-sub">${sub}</span></span>
      ${icon.next}
    </a>`;
  screen.innerHTML = `
    <header class="top"><h1 class="app" lang="zh-CN">生词</h1></header>
    <div class="tiles">
      ${tile("#/review", "Review", due ? `${due} due today` : "Nothing due today", due)}
      ${tile("#/hard", "Hard words", hard ? count(hard, "word") : "None yet", hard)}
    </div>
    <h2 class="section">Units</h2>
    <nav>
      ${units.map((u) => {
        const words = studied(u.words);
        return row(`#/unit/${u.unit}`, u.title, `Unit ${u.unit} · ${count(words.length, "word")} · ${known(words)} known`, ' lang="zh-CN"');
      }).join("")}
      ${row("#/mix", "Mix units", `${which} · ${count(mixWords.length, "word")} · ${known(mixWords)} known`)}
    </nav>
    ${own ? `<h2 class="section">${esc(own.en)}</h2>
    <nav>
      ${row("#/mine", own.title, `Words you added · ${count(studied(own.words).length, "word")} · ${known(studied(own.words))} known`, ' lang="zh-CN"')}
    </nav>` : ""}
    <a class="sync-line" href="#/sync" data-link data-sync-status>${esc(syncStatus())}</a>
    ${keeps ? "" : '<p class="note">This browser window doesn\'t keep what you study (a private window?). Open the app in a normal window.</p>'}`;
}

function setup(d) {
  const mode = setting("mode");
  const people = d.list.filter(data.isPerson).length;
  const pills = (name, values) => values.map(([value, text]) =>
    `<button class="pill" data-set="${name}" data-value="${value}" aria-pressed="${setting(name) === value}">${text}</button>`).join("");
  return `
    <section class="setup" aria-label="Study">
      <div class="modes">${MODES.map(([value, text]) =>
        `<button data-set="mode" data-value="${value}" aria-pressed="${mode === value}">${text}</button>`).join("")}</div>
      <div class="options">${OPTIONS[mode].map(([name, label, values]) => label
        ? `<span class="option-name">${label}</span><div class="pills">${pills(name, values)}</div>`
        : `<div class="pills span">${pills(name, values)}</div>`).join("")}</div>
      ${people ? `<label class="check"><input type="checkbox" data-people${setting("people") ? " checked" : ""}>
        Include people's names (${people})</label>` : ""}
      <button class="wide primary" data-start${d.words.length ? "" : " disabled"}>Start</button>
    </section>`;
}

function deckPage(d) {
  const units = data.unitList();
  const mixed = new Set(mixedUnits().map((u) => u.unit));
  const words = d.list.filter((w) => !data.isPerson(w));
  const people = d.list.filter(data.isPerson);
  const head = {
    unit: () => `<p class="kicker">Unit ${d.unit.unit}</p><h1 lang="zh-CN">${esc(d.unit.title)}</h1>
      <p class="muted">${esc(d.unit.en)}</p>`,
    mine: () => `<p class="kicker">Words you added</p><h1 lang="zh-CN">${esc(d.own.title)}</h1>
      <p class="muted">${esc(d.own.en)}</p>`,
    review: () => "<h1>Review</h1>",
    hard: () => "<h1>Hard words</h1>",
    mix: () => `<h1>Mix units</h1><div class="pills chips">
      <button class="pill" data-mix="all" aria-pressed="${mixed.size === units.length}">All</button>
      ${units.map((u) => `<button class="pill" data-mix="${u.unit}" aria-pressed="${mixed.has(u.unit)}"
        aria-label="Unit ${u.unit}" title="${esc(u.title)}">${u.unit}</button>`).join("")}</div>`,
  }[d.kind]();
  const stats = d.kind === "review" ? (d.words.length ? `${d.words.length} due today` : "Nothing is due today.")
    : d.kind === "hard" ? (d.list.length ? `${count(d.list.length, "word")}, starred or often missed`
      : "No hard words yet. Words you star, or miss often, come here.")
    : d.kind === "mix" && !mixed.size ? "Choose at least one unit."
    : `${count(d.words.length, "word")} · ${known(d.words)} known`;
  const row = (w) => wordRow(w, srs.starred(st, w));
  screen.innerHTML = `
    <header class="bar"><button class="icon" data-back aria-label="Back" title="Back">${icon.back}</button></header>
    <div class="deck-head">${head}<p class="muted">${stats}</p></div>
    ${d.list.length ? setup(d) : ""}
    <ul class="words">${words.map(row).join("")}</ul>
    ${people.length ? `<h2 class="section">People's names</h2><ul class="words">${people.map(row).join("")}</ul>` : ""}`;
}

function studyPage(d, mode) {
  if (!d.words.length) {
    // Nothing left to study here, e.g. Review opened again after all of it was done
    history.replaceState(history.state, "", d.path);
    shown = d.path;
    return deckPage(d);
  }
  const words = mode === "card" && setting("order") === "book" ? d.words : shuffle(d.words);
  close = study(screen, {
    title: d.label,
    words,
    pool: d.words,
    all: studied(data.allWords()),
    mode,
    options: { front: setting("front"), quiz: setting("quiz"), type: setting("type") },
    answer: (word, ok) => save({ type: "a", k: word.key, m: mode, ok: ok ? 1 : 0 }).catch(() => null),
    fix: async (word, wrong) => {
      await save({ type: "a", k: word.key, m: mode, ok: 1, fix: wrong.id });
      srs.redoWord(st, word.key, events);
    },
    starred: (word) => srs.starred(st, word),
    exit: () => back(d.path),
  });
}

// --- Moving between screens -----------------------------------------------------------------------

// "#/unit/6/quiz" -> { kind: "unit", number: 6, mode: "quiz" }; "#/review/card", "#/mix", "#/sync"...
function where() {
  const [kind = "", ...rest] = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const number = kind === "unit" ? Number(rest.shift()) : null;
  return { kind, number, mode: rest[0] ?? null };
}

const studying = () => MODES.some(([mode]) => mode === where().mode);

function render(force = false) {
  if (!force && shown === location.hash) return;
  if (!force) window.scrollTo(0, 0);
  shown = location.hash;
  if (close) {
    close();
    close = null;
    runSync(); // a study session has ended: share it
  }
  speech.stop();
  const place = where();
  if (place.kind !== "sync") showCode = false;
  if (place.kind === "sync") return syncPage();
  const d = place.kind ? deck(place) : null;
  if (!d) return home();
  if (studying()) return studyPage(d, place.mode);
  deckPage(d);
}

// The app keeps its own count of screens opened, so Back can use the browser's history (and the
// phone's back button does the same) without leaving the app.
function go(hash) {
  history.pushState({ depth: (history.state?.depth ?? 0) + 1 }, "", hash);
  render();
}

function back(fallback) {
  if (history.state?.depth > 0) history.back();
  else {
    history.replaceState({ depth: 0 }, "", fallback);
    render();
  }
}

addEventListener("popstate", () => render());
addEventListener("hashchange", () => render());

screen.addEventListener("click", async (e) => {
  const anchor = e.target.closest("a[data-link]");
  if (anchor) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    return go(anchor.getAttribute("href"));
  }
  const button = e.target.closest("button");
  if (!button) return;
  const { dataset } = button;
  if (dataset.say !== undefined) speech.speak(dataset.say);
  else if (dataset.star) toggleStar(dataset.star);
  else if (dataset.back !== undefined) back("#/");
  else if (dataset.start !== undefined) go(`${location.hash.replace(/\/$/, "")}/${setting("mode")}`);
  else if (dataset.syncNow !== undefined) runSync();
  else if (dataset.showCode !== undefined) {
    showCode = true;
    render(true);
  } else if (dataset.disconnect !== undefined) disconnect();
  else if (dataset.set) {
    await set(dataset.set, dataset.value);
    render(true);
  } else if (dataset.mix) {
    const all = data.unitList().map((u) => u.unit);
    const off = setting("mixOff").filter((n) => all.includes(n));
    const unit = Number(dataset.mix);
    await set("mixOff", dataset.mix === "all" ? (off.length ? [] : all)
      : off.includes(unit) ? off.filter((n) => n !== unit) : [...off, unit]);
    render(true);
  }
});

screen.addEventListener("change", async (e) => {
  if (e.target.matches("[data-people]")) {
    await set("people", e.target.checked);
    render(true);
  }
});

screen.addEventListener("submit", (e) => {
  if (!e.target.matches("[data-connect]")) return;
  e.preventDefault();
  connect(e.target.elements.key.value);
});

// Back to the app: words may be due since, and other devices may have synced. Leaving it: share
// what was done.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !studying()) render(true);
  runSync();
});
addEventListener("online", () => runSync());

// --- Start ----------------------------------------------------------------------------------------

async function start() {
  // Opened from the phone's setup code (#connect=<key>): take the key out of the address at once.
  const key = location.hash.match(/^#connect=([\w-]+)/)?.[1];
  if (key) history.replaceState({ depth: 0 }, "", "#/sync");
  keeps = await store.persistent();
  await data.loadSaved();
  events.push(...(await store.getAll("events")));
  for (const e of events) ids.add(e.id);
  brain = await data.brainEvents();
  link = (await store.get("kv", "sync")) || null;
  st = progress();
  if (!history.state) history.replaceState({ depth: 0 }, "", location.hash || "#/");
  if (data.unitList().length) render(true);
  else screen.innerHTML = '<p class="empty">Loading the word lists…</p>';
  const changed = await data.refresh();
  if (!data.unitList().length) {
    screen.innerHTML = `<p class="empty">Couldn't load the word lists. Check the internet connection, then
      <button class="link" onclick="location.reload()">try again</button>.</p>`;
    return;
  }
  if (changed && !studying()) render(true);
  if (key && key !== link?.token) await connect(key);
  else runSync();
}

// The online app works without internet once it has been opened (sw.js). The laptop's copy at
// 127.0.0.1 runs the files in its folder as they are, so changes show up straight away.
function offline() {
  if (!("serviceWorker" in navigator) || location.hostname === "127.0.0.1") return;
  const files = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
    "icons/apple-touch-icon.png"].map((path) => new URL(path, location.href).href);
  files.push(...performance.getEntriesByType("resource").map((entry) => entry.name)); // the scripts and styles
  navigator.serviceWorker.register("sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => registration.active?.postMessage({ keep: files }))
    .catch((error) => console.warn("No offline copy:", error));
}

start().then(offline, (error) => {
  console.error(error);
  screen.innerHTML = `<p class="empty">Something went wrong while opening the app: ${esc(error.message)}</p>`;
});
