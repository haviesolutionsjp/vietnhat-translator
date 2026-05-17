import { getAudioSettings } from "@/lib/audioSettings";
import type { Direction } from "@/lib/lang";
import { targetLang } from "@/lib/lang";

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;
const voicePickCache = new Map<string, SpeechSynthesisVoice | undefined>();
let speakGeneration = 0;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

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
    setTimeout(() => resolve(speechSynthesis.getVoices()), 250);
  });

  return voicesReady;
}

function scoreVoice(voice: SpeechSynthesisVoice, langCode: string): number {
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
    score += 15;
  }
  if (want.startsWith("vi") && /viet|vi-|lan|female|male/.test(name)) {
    score += 15;
  }

  return score;
}

function pickVoice(
  voices: SpeechSynthesisVoice[],
  langCode: string,
): SpeechSynthesisVoice | undefined {
  const cached = voicePickCache.get(langCode);
  if (cached !== undefined) return cached;

  if (voices.length === 0) return undefined;

  const best = [...voices].sort(
    (a, b) => scoreVoice(b, langCode) - scoreVoice(a, langCode),
  )[0];
  voicePickCache.set(langCode, best);
  return best;
}

function applyUtteranceSettings(
  utterance: SpeechSynthesisUtterance,
  langCode: string,
  voice?: SpeechSynthesisVoice,
): void {
  utterance.lang = langCode;
  if (voice) utterance.voice = voice;

  const audio = getAudioSettings();
  const isJa = langCode.toLowerCase().startsWith("ja");
  const baseRate = clamp(audio.ttsRate, 0.7, 1.6);

  utterance.volume = audio.ttsVolume;
  if (isJa && audio.jaClarityBoost) {
    utterance.rate = clamp(baseRate * 1.05, 0.1, 10);
    utterance.pitch = 1.04;
  } else {
    utterance.rate = clamp(baseRate, 0.1, 10);
    utterance.pitch = 1;
  }
}

/** Chrome cần khoảng trống ngắn sau cancel() trước speak() */
const CANCEL_TO_SPEAK_MS = 40;

function flushSpeak(
  gen: number,
  utterance: SpeechSynthesisUtterance,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (gen !== speakGeneration) {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled || gen !== speakGeneration) return;
      settled = true;
      resolve(ok);
    };

    utterance.onstart = () => finish(true);
    utterance.onend = () => finish(true);
    utterance.onerror = (event) => {
      if (event.error === "canceled") {
        finish(false);
        return;
      }
      finish(false);
    };

    try {
      speechSynthesis.speak(utterance);
    } catch {
      finish(false);
      return;
    }

    window.setTimeout(() => {
      if (settled || gen !== speakGeneration) return;
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        finish(true);
      }
    }, 120);
  });
}

/**
 * Phát âm bản dịch. Trả Promise để UI biết khi nào xong / lỗi.
 */
export function speakTranslation(
  text: string,
  langCode: string,
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed || !isTTSSupported()) return Promise.resolve(false);

  const gen = ++speakGeneration;

  const run = async (): Promise<boolean> => {
    if (gen !== speakGeneration) return false;

    speechSynthesis.cancel();
    if (speechSynthesis.paused) speechSynthesis.resume();

    await new Promise((r) => window.setTimeout(r, CANCEL_TO_SPEAK_MS));
    if (gen !== speakGeneration) return false;

    let voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      voices = await loadVoices();
    }
    if (gen !== speakGeneration) return false;

    const utterance = new SpeechSynthesisUtterance(trimmed);
    applyUtteranceSettings(utterance, langCode, pickVoice(voices, langCode));

    return flushSpeak(gen, utterance);
  };

  return run();
}

export function speakForDirection(
  text: string,
  direction: Direction,
): Promise<boolean> {
  return speakTranslation(text, targetLang(direction));
}

export function cancelSpeech(): void {
  speakGeneration++;
  if (isTTSSupported()) speechSynthesis.cancel();
}
