// speech.js - says a word with the device's own Chinese voice. Voices built into the phone or
// Windows come first: online ones (Chrome's Google voices) need servers that are blocked in China.

const synth = window.speechSynthesis;
export const canSpeak = !!synth && typeof SpeechSynthesisUtterance === "function";

let chosen; // undefined until the voices are known, then the voice to use (null: none for Chinese)

// Mandarin from the mainland first, then Taiwan; voices on the device before online ones.
// zh-HK is Cantonese, so it doesn't count.
function rank(voice) {
  const lang = voice.lang.toLowerCase().replace(/_/g, "-");
  if (!/^(zh|cmn)\b/.test(lang) || /hk|mo|yue/.test(lang)) return 0;
  return (/tw|hant/.test(lang) ? 1 : 3) + (voice.localService ? 1 : 0);
}

function voice() {
  if (chosen === undefined) {
    const voices = synth.getVoices();
    if (!voices.length) return null; // not loaded yet
    chosen = voices.filter(rank).sort((a, b) => rank(b) - rank(a))[0] ?? null;
  }
  return chosen;
}

if (canSpeak) {
  synth.addEventListener?.("voiceschanged", () => (chosen = undefined));
  voice();
}

export function speak(text) {
  if (!canSpeak) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const v = voice();
  if (v) utterance.voice = v;
  utterance.lang = v?.lang ?? "zh-CN";
  utterance.rate = 0.85;
  synth.speak(utterance);
}

export function stop() {
  if (canSpeak) synth.cancel();
}
