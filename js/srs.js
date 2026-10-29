// srs.js - progress is never saved as such: it's worked out from the log of events (answers, stars,
// settings), so the logs of several devices can simply be put together.
//
// Spaced repetition with boxes: a right answer moves a word up one box (at most once a day) and it
// comes back after 1, 3, 7, 14 or 30 days. A miss puts it back in box 0: it's due again today, and
// after you get it right, tomorrow. A word is "known" from box 2: right on two different days in a row.

const INTERVALS = [0, 1, 3, 7, 14, 30];

// The day of a time, in local time; a new day starts at 4 a.m. so late study counts for the day before.
export function dayOf(t) {
  const d = new Date(t - 4 * 3600e3);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}

const order = (a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function empty() {
  return { words: new Map(), starKey: new Map(), starHanzi: new Map(), settings: {}, settingTimes: {},
           dismissed: new Set(), started: new Map(), fixed: new Set() };
}

function answer(st, e) {
  const s = st.words.get(e.k) || { box: 0, due: null, day: null, history: [], seen: 0 };
  const day = dayOf(e.t);
  s.seen += 1;
  s.history = [...s.history, e.ok ? 1 : 0].slice(-4);
  if (!e.ok) Object.assign(s, { box: 0, due: day, day: null });
  else if (s.box === 0) Object.assign(s, { box: 1, due: day + 1, day });
  else if (s.day !== day) {
    s.box = Math.min(s.box + 1, INTERVALS.length - 1);
    Object.assign(s, { due: day + INTERVALS[s.box], day });
  }
  st.words.set(e.k, s);
}

// Add one event to the progress. Events must come in time order (new ones on this device do).
export function apply(st, e) {
  if (st.fixed.has(e.id)) return;
  switch (e.type) {
    case "a": // an answer: k word key, m mode, ok 1/0; fix = the id of an answer it corrects
      if (e.fix) st.fixed.add(e.fix);
      answer(st, e);
      break;
    case "s": // a star on (on: 1) or off: by word key (k), or by characters (hz) from the study log
      (e.k ? st.starKey : st.starHanzi).set(e.k || e.hz, e);
      break;
    case "set": // a setting
      if (!(st.settingTimes[e.name] > e.t)) {
        st.settings[e.name] = e.value;
        st.settingTimes[e.name] = e.t;
      }
      break;
    case "dis": // a "Unit 7 started" notice dismissed
      st.dismissed.add(e.unit);
      break;
    case "unit": // the second brain saw a unit start
      st.started.set(e.unit, e);
      break;
  }
}

export function derive(events) {
  const st = empty();
  for (const e of events) if (e.fix) st.fixed.add(e.fix);
  for (const e of [...events].sort(order)) apply(st, e);
  return st;
}

// Work one word's progress out again, after an answer was corrected ("I was right").
export function redoWord(st, key, events) {
  st.words.delete(key);
  for (const e of events.filter((e) => e.type === "a" && e.k === key && !st.fixed.has(e.id)).sort(order)) {
    answer(st, e);
  }
}

export const known = (st, key) => (st.words.get(key)?.box ?? 0) >= 2;

export function due(st, key, today) {
  const s = st.words.get(key);
  return !!s && (s.box === 0 ? s.seen > 0 : s.due <= today);
}

export function starred(st, word) {
  const byKey = st.starKey.get(word.key);
  const byHanzi = st.starHanzi.get(word.hanzi);
  const latest = !byKey ? byHanzi : !byHanzi ? byKey : byKey.t >= byHanzi.t ? byKey : byHanzi;
  return !!latest?.on;
}

// Missed at least 2 of the last 4 answers.
export const oftenMissed = (st, key) => (st.words.get(key)?.history.filter((ok) => !ok).length ?? 0) >= 2;

export const hard = (st, word) => starred(st, word) || oftenMissed(st, word.key);
