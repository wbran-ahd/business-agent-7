/**
 * Urdu speech synthesis.
 *
 * `speechSynthesis` is only useful for Urdu when an Urdu voice is actually
 * installed: setting `lang = "ur-PK"` alone makes a phone with no Urdu voice
 * read the text with an English accent. So this picks a real `ur` voice when one
 * exists, keeps the language hint either way, and exposes the chosen voice name
 * so the settings screen can say honestly which voice is being used.
 *
 * Voice lists load asynchronously in Chrome, hence the one-time `voiceschanged`
 * priming instead of trusting the first `getVoices()` call.
 */
import { clampTtsRate } from "./khata";

let cachedVoices: SpeechSynthesisVoice[] = [];
let primed = false;

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

/** Registers the async voice-list callback once, and seeds the cache. */
export function primeVoices(): void {
  const speech = synth();
  if (!speech || primed) return;
  primed = true;
  const load = () => {
    cachedVoices = speech.getVoices();
  };
  load();
  speech.addEventListener?.("voiceschanged", load);
}

export function urduVoice(): SpeechSynthesisVoice | null {
  primeVoices();
  const speech = synth();
  if (speech && cachedVoices.length === 0) cachedVoices = speech.getVoices();
  return (
    cachedVoices.find((voice) => (voice.lang ?? "").toLowerCase().startsWith("ur")) ??
    cachedVoices.find((voice) => /urdu/i.test(voice.name ?? "")) ??
    null
  );
}

/** `null` when the device has no Urdu voice (text-only fallback). */
export function urduVoiceName(): string | null {
  return urduVoice()?.name ?? null;
}

export function isSpeechAvailable(): boolean {
  return synth() !== null;
}

export type SpeakOptions = { enabled?: boolean; rate?: number };

/** Speaks one line of Urdu, replacing anything still queued. */
export function speakUrdu(text: string, options: SpeakOptions = {}): boolean {
  if (!text || options.enabled === false) return false;
  const speech = synth();
  if (!speech) return false;
  try {
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ur-PK";
    const voice = urduVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = clampTtsRate(options.rate ?? 0.95);
    utterance.pitch = 1;
    speech.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  try {
    synth()?.cancel();
  } catch {
    /* ignore */
  }
}
