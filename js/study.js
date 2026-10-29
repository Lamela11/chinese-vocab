// study.js - the three ways to study a list of words: flashcards, a quiz with four choices, and
// typing the pinyin or the meaning. Each answer is saved as it's given, so you can leave at any
// time. A word you miss comes back a few words later, until you get it right.

import { checkMeaning, checkPinyin, marked, plainEnglish, toneless } from "./pinyin.js";
import { big, esc, icon, meaning, shuffle, tools, wordRow } from "./ui.js";

const AGAIN_AFTER = 3; // a missed word comes back after this many others

const onButton = (e) => e.target.closest?.("button, a, input");

// Two words would both be right answers to the same question if they share a short meaning
// (二 and 两 are both "two", 想 and 要 both "want") or sound exactly alike (他 and 她 are both tā).
const shortMeanings = (word) =>
  word.en.split(/[,;]/).map(plainEnglish).filter((m) => m && m.split(" ").length <= 2);

function clash(a, b) {
  if (a.key === b.key || a.hanzi === b.hanzi || a.en === b.en) return true;
  if (a.pinyin.normalize("NFC").toLowerCase().replace(/\s/g, "") === b.pinyin.normalize("NFC").toLowerCase().replace(/\s/g, "")) return true;
  const mine = shortMeanings(a);
  return shortMeanings(b).some((m) => mine.includes(m));
}

// ctx: title; words, in the order to study them; pool and all, the words wrong quiz choices come
// from (the list's own words first); mode ("card", "quiz" or "type"); options (front, quiz, type);
// answer(word, ok) and fix(word, savedAnswer) to save answers; starred(word); exit().
// Returns a function that tidies up when the screen closes.
export function study(screen, ctx) {
  let session;
  let onKey = null;

  const keydown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") ctx.exit();
    else onKey?.(e);
  };
  document.addEventListener("keydown", keydown);

  function begin(words) {
    session = { left: [...words], total: words.length, done: 0, missed: [] };
    next();
  }

  function next() {
    onKey = null;
    if (!session.left.length) return finish();
    ({ card, quiz, type })[ctx.mode](session.left[0]);
  }

  // The word leaves the front of the line; a miss puts it back a few places later.
  function answered(word, ok) {
    session.left.shift();
    if (ok) session.done += 1;
    else {
      if (!session.missed.includes(word)) session.missed.push(word);
      session.left.splice(Math.min(AGAIN_AFTER, session.left.length), 0, word);
    }
    showCount();
  }

  function showCount() {
    const count = screen.querySelector(".count");
    if (count) count.textContent = `${session.done} / ${session.total}`;
  }

  function frame(kind, body) {
    screen.innerHTML = `
      <div class="study ${kind}">
        <header class="bar">
          <button class="icon" data-exit aria-label="Back" title="Back (Esc)">${icon.back}</button>
          <span class="bar-title">${esc(ctx.title)}</span>
          <span class="count">${session.done} / ${session.total}</span>
        </header>
        ${body}
      </div>`;
    screen.querySelector("[data-exit]").onclick = ctx.exit;
    window.scrollTo(0, 0);
  }

  // The full word: characters, pinyin, meaning, star and speaker.
  const line = (word) => `
    <p class="reveal">
      <span class="hz" lang="zh-CN">${esc(word.hanzi)}</span>
      <span class="py">${esc(word.pinyin)}</span>
      <span class="en">${esc(word.en)}</span>
      ${tools(word, ctx.starred(word))}
    </p>`;

  // --- Flashcards: tap to turn over, then Got it or Again ---------------------------------------

  function card(word) {
    const side = ctx.options.front;
    const front = side === "pinyin" ? `<p class="big py">${esc(word.pinyin)}</p>`
      : side === "en" ? `<p class="big en">${meaning(word, false)}</p>`
      : big(word);
    frame("cards", `
      <div class="card" tabindex="0" role="button" aria-label="Turn the card over">
        <div class="card-inner">
          <div class="face front">${front}</div>
          <div class="face back">
            ${big(word)}
            <p class="reading">${esc(word.pinyin)}</p>
            <p class="meaning">${meaning(word)}</p>
            ${tools(word, ctx.starred(word))}
          </div>
        </div>
      </div>
      <div class="actions">
        <button class="wide" data-flip>Show answer</button>
        <div class="pair" hidden>
          <button class="wide" data-again title="Again (1)">Again</button>
          <button class="wide primary" data-got title="Got it (2)">Got it</button>
        </div>
      </div>`);
    const el = screen.querySelector(".card");
    const flipButton = screen.querySelector("[data-flip]");
    let turned = false;
    const flip = () => {
      el.classList.toggle("flipped");
      if (!turned) {
        turned = true;
        flipButton.hidden = true;
        screen.querySelector(".pair").hidden = false;
      }
    };
    const answer = (ok) => {
      ctx.answer(word, ok);
      answered(word, ok);
      next();
    };
    el.onclick = (e) => !e.target.closest("button") && flip();
    flipButton.onclick = flip;
    screen.querySelector("[data-again]").onclick = () => answer(false);
    screen.querySelector("[data-got]").onclick = () => answer(true);
    onKey = (e) => {
      if ((e.key === " " || e.key === "Enter") && !onButton(e)) {
        e.preventDefault();
        flip();
      } else if (turned && (e.key === "1" || e.key === "ArrowLeft")) answer(false);
      else if (turned && (e.key === "2" || e.key === "ArrowRight")) answer(true);
    };
  }

  // --- Quiz: four choices, in one of three directions -----------------------------------------

  // Three wrong choices: from the list being studied if it has enough, else from every unit.
  // Words like the answer make better ones: the same part of speech, length or sound.
  function wrongChoices(word, direction) {
    const picked = [];
    for (const pool of [ctx.pool, ctx.all]) {
      const scored = shuffle(pool).map((w) => {
        let score = Math.random() * 1.5;
        if (w.pos && w.pos === word.pos) score += direction === "pinyin-hanzi" ? 1 : 2;
        if ([...w.hanzi].length === [...word.hanzi].length) score += 1;
        if (direction === "pinyin-hanzi" && toneless(w.pinyin) === toneless(word.pinyin)) score += 3;
        return [score, w];
      }).sort((a, b) => b[0] - a[0]);
      for (const [, w] of scored) {
        if (picked.length === 3) return picked;
        if (![word, ...picked].some((other) => clash(w, other))) picked.push(w);
      }
    }
    return picked;
  }

  function quiz(word) {
    const direction = ctx.options.quiz;
    const toHanzi = direction !== "hanzi-en";
    const choices = shuffle([word, ...wrongChoices(word, direction)]);
    const prompt = direction === "hanzi-en" ? big(word)
      : direction === "pinyin-hanzi" ? `<p class="big py">${esc(word.pinyin)}</p>`
      : `<p class="big en">${esc(word.en)}</p>`;
    frame("quiz", `
      <div class="prompt">${prompt}</div>
      <div class="choices${toHanzi ? " zh" : ""}">
        ${choices.map((w, i) => `<button class="choice" data-choice="${i}"${toHanzi ? ' lang="zh-CN"' : ""}
          title="${i + 1}">${esc(toHanzi ? w.hanzi : w.en)}</button>`).join("")}
      </div>
      <div class="after" hidden>
        ${line(word)}
        <button class="wide primary" data-next>Next</button>
      </div>`);
    let chosen = false;
    const choose = (i) => {
      if (chosen || !choices[i]) return;
      chosen = true;
      const ok = choices[i] === word;
      screen.querySelectorAll(".choice").forEach((b, j) => {
        if (choices[j] === word) b.classList.add("right");
        else if (j === i) b.classList.add("wrong");
      });
      screen.querySelector(".choices").classList.add("answered");
      ctx.answer(word, ok);
      answered(word, ok);
      screen.querySelector(".after").hidden = false;
      screen.querySelector("[data-next]").focus({ preventScroll: true });
    };
    screen.querySelectorAll(".choice").forEach((b) => (b.onclick = () => choose(Number(b.dataset.choice))));
    screen.querySelector("[data-next]").onclick = next;
    onKey = (e) => {
      if (!chosen && e.key >= "1" && e.key <= "4") choose(Number(e.key) - 1);
      else if (chosen && (e.key === "Enter" || e.key === " ") && !onButton(e)) {
        e.preventDefault();
        next();
      }
    };
  }

  // --- Type: the pinyin (tones count) or the meaning ------------------------------------------

  function type(word) {
    const pinyin = ctx.options.type === "pinyin";
    frame("type", `
      <div class="prompt">${big(word)}${pinyin ? `<p class="hint">${esc(word.en)}</p>` : ""}</div>
      <form class="answer" autocomplete="off">
        <input name="answer" aria-label="${pinyin ? "Pinyin" : "Meaning"}" placeholder="${pinyin ? "Pinyin, like xu1yao4" : "Meaning in English"}"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
        <p class="preview" aria-hidden="true"></p>
        <div class="result" hidden></div>
        <button class="wide primary">Check</button>
      </form>`);
    const form = screen.querySelector("form");
    const input = form.elements.answer;
    const preview = form.querySelector(".preview");
    const result = form.querySelector(".result");
    const button = form.querySelector("button.primary");
    const shownAt = Date.now();
    let saved = null; // the answer being saved, once checked
    input.focus();
    if (pinyin) {
      input.oninput = () => (preview.textContent = /[0-5v]|u:/i.test(input.value) ? marked(input.value) : "");
    }
    // The answer with tone marks, and the rest of the word.
    const answerLines = (cls) => `
      <p class="line"><span class="main${cls}">${pinyin ? esc(word.pinyin) : esc(word.en)}</span></p>
      <p class="line sub">${pinyin ? esc(word.en) : esc(word.pinyin)} ${tools(word, ctx.starred(word))}</p>`;

    form.onsubmit = (e) => {
      e.preventDefault();
      if (saved) return next();
      if (Date.now() - shownAt < 400) return; // the Enter that moved on from the last word
      const text = input.value.trim();
      const ok = !!text && (pinyin ? checkPinyin(text, word.pinyin) : checkMeaning(text, word.en));
      const firstMiss = !ok && !session.missed.includes(word);
      saved = ctx.answer(word, ok);
      answered(word, ok);
      input.readOnly = true;
      preview.textContent = "";
      result.hidden = false;
      result.className = `result ${ok ? "right" : "wrong"}`;
      if (ok) result.innerHTML = `<span class="mark" aria-label="Right">✓</span>${answerLines("")}`;
      else {
        const yours = text ? `<s>${esc(pinyin ? marked(text) : text)}</s>` : "<span>No answer</span>";
        const chinese = /[\u3400-\u9fff]/.test(text) && pinyin;
        result.innerHTML = `
          <span class="mark" aria-label="Not right">✗</span>
          <p class="line yours">${yours}</p>
          ${answerLines(" correct")}
          ${chinese ? '<p class="line sub">Type pinyin in Latin letters, like xu1yao4.</p>'
            : text ? '<button type="button" class="link" data-right>I was right</button>' : ""}`;
        result.querySelector("[data-right]")?.addEventListener("click", async () => {
          const i = session.left.lastIndexOf(word);
          if (i >= 0) session.left.splice(i, 1);
          if (firstMiss) session.missed.splice(session.missed.indexOf(word), 1);
          session.done += 1;
          showCount();
          result.className = "result right";
          result.innerHTML = `<span class="mark" aria-label="Right">✓</span>${answerLines("")}<p class="line sub">Counted as right.</p>`;
          button.focus({ preventScroll: true });
          const wrong = await saved;
          if (wrong) await ctx.fix(word, wrong);
        });
      }
      button.textContent = "Next";
    };
    onKey = (e) => {
      if (e.key === "Enter" && !onButton(e)) form.requestSubmit();
    };
  }

  // --- The end: what took more than one try -----------------------------------------------------

  function finish() {
    const { missed, total } = session;
    screen.innerHTML = `
      <div class="study done">
        <header class="bar">
          <button class="icon" data-exit aria-label="Back">${icon.back}</button>
          <span class="bar-title">${esc(ctx.title)}</span>
          <span class="count"></span>
        </header>
        <h1>Done</h1>
        <p class="muted">You went through all ${total} ${total === 1 ? "word" : "words"}.${missed.length ? " These took more than one try:" : ""}</p>
        ${missed.length ? `<ul class="words">${missed.map((w) => wordRow(w, ctx.starred(w))).join("")}</ul>` : ""}
        <div class="actions">
          ${missed.length ? `<button class="wide primary" data-redo>Go over ${missed.length === 1 ? "it" : `these ${missed.length}`} again</button>` : ""}
          <button class="wide${missed.length ? "" : " primary"}" data-exit>Back to ${esc(ctx.title)}</button>
        </div>
      </div>`;
    screen.querySelectorAll("[data-exit]").forEach((b) => (b.onclick = ctx.exit));
    screen.querySelector("[data-redo]")?.addEventListener("click", () => begin(shuffle(missed)));
    screen.querySelector(".actions .wide").focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  begin(ctx.words);
  return () => document.removeEventListener("keydown", keydown);
}
