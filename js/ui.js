// ui.js - small pieces the screens share: text made safe for HTML, the icons, and how a word is
// shown (its row in a list, its meaning, its star and speaker buttons).

import { canSpeak } from "./speech.js";

export const esc = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const icon = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/></svg>',
  say: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9.5v5h3.2l4.3 3.6V5.9L7.7 9.5z"/>' +
    '<path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>',
};

export function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The characters, as big as the screen allows for their number.
export const big = (word) =>
  `<p class="big hz" lang="zh-CN" style="--n:${[...word.hanzi].length}">${esc(word.hanzi)}</p>`;

export function meaning(word, withMeasureWords = true) {
  const pos = word.pos ? `<i>${esc(word.pos)}</i> ` : "";
  const mw = withMeasureWords && word.mw
    ? ` · measure word${word.mw.length > 1 ? "s" : ""} ${word.mw.map(([hz, py]) =>
      `<span lang="zh-CN">${esc(hz)}</span> ${esc(py)}`).join(", ")}`
    : "";
  return `${pos}${esc(word.en)}${mw}`;
}

export function tools(word, starred) {
  const star = `<button class="icon star" data-star="${esc(word.key)}" aria-pressed="${!!starred}" ` +
    `aria-label="Star ${esc(word.hanzi)}" title="Star">${icon.star}</button>`;
  const say = canSpeak
    ? `<button class="icon say" data-say="${esc(word.hanzi)}" aria-label="Say ${esc(word.hanzi)}" title="Listen">${icon.say}</button>`
    : "";
  return `<span class="tools">${star}${say}</span>`;
}

export const wordRow = (word, starred) => `
  <li class="word${word.parent ? " part" : ""}">
    <div class="word-text">
      <div class="word-head"><span class="hz" lang="zh-CN">${esc(word.hanzi)}</span><span class="py">${esc(word.pinyin)}</span></div>
      <div class="en">${meaning(word)}</div>
    </div>
    ${tools(word, starred)}
  </li>`;
