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
    setTimeout(() => resolve(speechSynthesis.getVoices()), 400);
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
  const baseRate = clamp(audio.ttsRate, 0.7, 1.4);

  utterance.volume = audio.ttsVolume;
  if (isJa && audio.jaClarityBoost) {
    utterance.rate = clamp(baseRate * 0.92, 0.1, 10);
    utterance.pitch = 1.05;
  } else {
    utterance.rate = clamp(isJa ? baseRate * 0.97 : baseRate, 0.1, 10);
    utterance.pitch = 1;
  }
}

/** Phát âm ngay — không chờ hết câu đọc để cập nhật UI */
export function speakTranslation(
  text: string,
  langCode: string,
): boolean {
  const trimmed = text.trim();
  if (!trimmed || !isTTSSupported()) return false;

  const gen = ++speakGeneration;
  speechSynthesis.cancel();
  if (speechSynthesis.paused) speechSynthesis.resume();

  const startSpeak = (voices: SpeechSynthesisVoice[]) => {
    if (gen !== speakGeneration) return;

    const utterance = new SpeechSynthesisUtterance(trimmed);
    applyUtteranceSettings(utterance, langCode, pickVoice(voices, langCode));

    utterance.onerror = () => {
      /* bỏ qua — có thể bị cancel bởi câu mới */
    };

    speechSynthesis.speak(utterance);
  };

  const cached = speechSynthesis.getVoices();
  if (cached.length > 0) {
    startSpeak(cached);
    return true;
  }

  void loadVoices().then((voices) => startSpeak(voices));
  return true;
}

export function speakForDirection(text: string, direction: Direction): boolean {
  return speakTranslation(text, targetLang(direction));
}

export function cancelSpeech(): void {
  speakGeneration++;
  if (isTTSSupported()) speechSynthesis.cancel();
}
