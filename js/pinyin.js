// pinyin.js - checks what you type in the Type mode. Pinyin can be typed with tone numbers
// (xu1yao4 = xūyào; 5, 0 or no number = neutral tone), with v or u: for ü (lv4shi1 = lǜshī), with
// tone marks, with or without spaces. Tones are strict: every syllable needs the tone the book
// gives it, including the tone changes of 一 and 不 that it marks (yìqǐ, bú kèqi). Meanings are
// looser: one of the meanings is enough, and a typo in a longer word is forgiven.

const MARKS = { a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ" };
const PLAIN = {}; // "ǎ" -> ["a", 3]
for (const [letter, marked] of Object.entries(MARKS)) {
  [...marked].forEach((ch, i) => (PLAIN[ch] = [letter, i + 1]));
}

// One syllable of toneless pinyin. n, ng and r end a syllable only when no vowel follows: after
// the first syllable, a syllable never starts with a vowel (that needs an apostrophe: Xī'ān).
const SYLLABLE =
  /(?:[zcs]h|[bpmfdtnlgkhjqxrzcsyw])?(?:[iuü]?[aeo](?:[iou]|ng?(?![aeiouü])|r(?![aeiouü]))?|[iuü](?:ng?(?![aeiouü])|[iu])?)/y;

// "kuangquanshui" -> ["kuang", "quan", "shui"], or null if it isn't pinyin.
function split(letters) {
  const out = [];
  SYLLABLE.lastIndex = 0;
  while (SYLLABLE.lastIndex < letters.length) {
    const match = SYLLABLE.exec(letters);
    if (!match) return null;
    out.push(match[0]);
  }
  return out;
}

// The main reading and any others in brackets: "shéi (shuí)" -> ["shéi", "shuí"].
export function forms(pinyin) {
  const main = pinyin.replace(/\s*\(.*?\)/g, "").trim();
  return [main, ...[...pinyin.matchAll(/\(\s*([^)]+?)\s*\)/g)].map((m) => m[1])];
}

// The book's pinyin as syllables with their tone (5 = neutral) and where their letters start and
// end, spaces left out: "Zhōngguó rén" -> zhong 1 (0-5), guo 2 (5-8), ren 2 (8-11). Null if it
// can't be read.
function syllables(pinyin) {
  const out = [];
  let offset = 0;
  for (const word of pinyin.normalize("NFC").toLowerCase().split(/[\s'’-]+/)) {
    let letters = "";
    const tones = [];
    for (const ch of word) {
      if (PLAIN[ch]) tones.push([letters.length, PLAIN[ch][1]]);
      letters += PLAIN[ch]?.[0] ?? ch;
    }
    const parts = split(letters);
    if (!parts) return null;
    let start = 0;
    for (const part of parts) {
      const end = start + part.length;
      const marks = tones.filter(([i]) => i >= start && i < end);
      if (marks.length > 1) return null;
      out.push({ letters: part, tone: marks[0]?.[1] ?? 5, start: offset + start, end: offset + end });
      start = end;
    }
    offset += letters.length;
  }
  return out;
}

// What was typed: its letters without tones, and the tones it gives, each one either a mark on a
// letter (at: the letter's index) or a number (after: how many letters came before it).
function typed(text) {
  let letters = "";
  const tones = [];
  for (const ch of text.normalize("NFC").toLowerCase().replace(/u:/g, "ü").replace(/v/g, "ü")) {
    if (PLAIN[ch]) {
      tones.push({ at: letters.length, tone: PLAIN[ch][1] });
      letters += PLAIN[ch][0];
    } else if (/[a-zü]/.test(ch)) letters += ch;
    else if (/[0-5]/.test(ch)) tones.push({ after: letters.length, tone: Number(ch) || 5 });
    else if (!/[\s'’.-]/.test(ch)) return null;
  }
  return letters ? { letters, tones } : null;
}

// After j, q, x and y, ü is written u (xū, jú), so typing either is fine.
const fold = (letters) => letters.replace(/([jqxy])ü/g, "$1u");
const plain = (pinyin) => fold(pinyin.normalize("NFC").toLowerCase().replace(/[\s'’-]/g, ""));

// Right if the letters are the book's and every syllable has the book's tone. A tone number counts
// for the syllable it comes after (or is typed in), a syllable with no tone is neutral.
function sameAs(answer, form) {
  const book = syllables(form);
  if (!book) return null;
  if (fold(answer.letters) !== fold(book.map((s) => s.letters).join(""))) return false;
  const given = book.map(() => new Set());
  for (const t of answer.tones) {
    const i = book.findIndex((s) =>
      "at" in t ? t.at >= s.start && t.at < s.end : t.after > s.start && t.after <= s.end);
    if (i < 0) return false;
    given[i].add(t.tone);
  }
  return book.every((s, i) => given[i].size <= 1 && ([...given[i]][0] ?? 5) === s.tone);
}

export function checkPinyin(text, pinyin) {
  const answer = typed(text);
  if (!answer) return false;
  return forms(pinyin).some((form) => sameAs(answer, form) ?? plain(marked(text)) === plain(form));
}

// Put the tone mark on the right vowel: a or e, the o of ou, or else the last vowel (liú, guì).
function mark(syllable, tone) {
  const lower = syllable.toLowerCase();
  let i = lower.search(/[ae]/);
  if (i < 0) i = lower.indexOf("ou");
  if (i < 0) i = Math.max(...["i", "o", "u", "ü"].map((v) => lower.lastIndexOf(v)));
  if (i < 0) return syllable;
  const ch = MARKS[lower[i]][tone - 1];
  return syllable.slice(0, i) + (syllable[i] === lower[i] ? ch : ch.toUpperCase()) + syllable.slice(i + 1);
}

// "xu1yao4" -> "xūyào", "lv4shi1" -> "lǜshī", "ni3men" -> "nǐmen". Tone marks typed as such stay.
// A number goes with the syllable just before it, so "mama1" is ma-mā.
export function marked(text) {
  return text.normalize("NFC").replace(/u:/g, "ü").replace(/U:/g, "Ü").replace(/v/g, "ü").replace(/V/g, "Ü")
    .replace(/([a-zA-ZüÜ]+)([0-5])/g, (_, letters, n) => {
      const tone = Number(n);
      if (tone === 0 || tone === 5) return letters;
      const parts = split(letters.toLowerCase()) ?? [letters];
      const start = letters.length - parts[parts.length - 1].length;
      return letters.slice(0, start) + mark(letters.slice(start), tone);
    });
}

// "Xūyào" -> "xuyao" (ü stays): for spotting words that sound alike.
export const toneless = (pinyin) =>
  pinyin.normalize("NFD").replace(/[\u0300\u0301\u0304\u030c]/g, "").normalize("NFC").toLowerCase().replace(/[\s'’-]/g, "");

// A meaning as plain words: "To buy (sth.)!" -> "buy sth". a, an, the and to are left out.
export function plainEnglish(text) {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ").replace(/\b(?:a|an|the|to)\b/g, " ").replace(/\s+/g, " ").trim();
}

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

function close(answer, meaning) {
  if (answer.replace(/ /g, "") === meaning.replace(/ /g, "")) return true;
  const typos = meaning.length >= 8 ? 2 : meaning.length >= 5 ? 1 : 0;
  return typos > 0 && distance(answer, meaning) <= typos;
}

// "good, fine, nice": "fine", "good, nice" and "fien" are right. Brackets are optional: "you" or
// "you (singular)". Several meanings typed with commas are right if each of them is.
export function checkMeaning(text, en) {
  const meanings = new Set();
  for (const part of [en, ...en.split(/[,;]/)]) {
    meanings.add(plainEnglish(part));
    meanings.add(plainEnglish(part.replace(/\(.*?\)/g, "")));
  }
  meanings.delete("");
  const right = (answer) => [...meanings].some((meaning) => close(answer, meaning));
  const answers = text.split(/[,;/]/).map(plainEnglish).filter(Boolean);
  return answers.length > 0 && (right(plainEnglish(text)) || answers.every(right));
}
