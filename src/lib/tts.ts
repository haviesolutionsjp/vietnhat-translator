import type { AudioSettings } from "@/lib/audioSettings";
import { ttsParamsFromSettings } from "@/lib/audioSettings";
import type { Direction } from "@/lib/lang";
import { targetLang } from "@/lib/lang";

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;
let speakGeneration = 0;

export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function prepareVoices(): void {
  if (!isTTSSupported()) return;
  speechSynthesis.getVoices();
  if (speechSynthesis.paused) speechSynthesis.resume();
  void loadVoices();
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesReady) return voicesReady;

  voicesReady = new Promise((resolve) => {
    const pick = () => {
      const list = speechSynthesis.getVoices();
      if (list.length > 0) resolve(list);
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
    setTimeout(() => resolve(speechSynthesis.getVoices()), 800);
  });

  return voicesReady;
}

function scoreVoice(
  voice: SpeechSynthesisVoice,
  langCode: string,
  japaneseClarity: boolean,
): number {
  const lang = voice.lang.toLowerCase();
  const want = langCode.toLowerCase();
  let score = 0;

  if (lang === want) score += 100;
  else if (lang.startsWith(want.slice(0, 2))) score += 60;
  else if (want.startsWith("ja") && lang.startsWith("ja")) score += 40;
  else if (want.startsWith("vi") && lang.startsWith("vi")) score += 40;

  if (voice.localService) score += 25;

  const name = voice.name.toLowerCase();
  if (want.startsWith("ja") && /japan|ja-|kyoko|haruka|otoya|google/.test(name)) {
    score += japaneseClarity ? 25 : 15;
  }
  if (want.startsWith("vi") && /viet|vi-|lan|female|male/.test(name)) {
    score += 15;
  }

  return score;
}

function pickVoice(
  voices: SpeechSynthesisVoice[],
  langCode: string,
  japaneseClarity: boolean,
): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) return undefined;
  return [...voices].sort(
    (a, b) =>
      scoreVoice(b, langCode, japaneseClarity) -
      scoreVoice(a, langCode, japaneseClarity),
  )[0];
}

export async function speakTranslation(
  text: string,
  langCode: string,
  settings: AudioSettings,
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed || !isTTSSupported()) return false;

  const gen = ++speakGeneration;
  speechSynthesis.cancel();
  if (speechSynthesis.paused) speechSynthesis.resume();

  const voices = await loadVoices();
  if (gen !== speakGeneration) return false;

  const { volume, rate, pitch } = ttsParamsFromSettings(settings, langCode);

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.lang = langCode;
    const voice = pickVoice(voices, langCode, settings.japaneseClarity);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled || gen !== speakGeneration) return;
      settled = true;
      resolve(ok);
    };

    utterance.onstart = () => finish(true);
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);

    speechSynthesis.speak(utterance);

    window.setTimeout(() => {
      if (settled || gen !== speakGeneration) return;
      if (speechSynthesis.speaking || speechSynthesis.pending) finish(true);
    }, 300);

    window.setTimeout(() => {
      if (!settled && gen === speakGeneration && !speechSynthesis.speaking) {
        finish(false);
      }
    }, 1200);
  });
}

export async function speakForDirection(
  text: string,
  direction: Direction,
  settings: AudioSettings,
): Promise<boolean> {
  return speakTranslation(text, targetLang(direction), settings);
}

export function cancelSpeech(): void {
  speakGeneration++;
  if (isTTSSupported()) speechSynthesis.cancel();
}
