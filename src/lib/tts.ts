import { getAudioSettings } from "@/lib/audioSettings";
import type { Direction } from "@/lib/lang";
import { targetLang } from "@/lib/lang";

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;
let speakGeneration = 0;

export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Gọi sau thao tác người dùng (bấm Nói) để tải giọng trên mobile */
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
  if (voices.length === 0) return undefined;

  return [...voices].sort(
    (a, b) => scoreVoice(b, langCode) - scoreVoice(a, langCode),
  )[0];
}

/** Phát âm văn bản ngôn ngữ đích (ja-JP / vi-VN) */
export async function speakTranslation(
  text: string,
  langCode: string,
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed || !isTTSSupported()) return false;

  const gen = ++speakGeneration;
  speechSynthesis.cancel();

  if (speechSynthesis.paused) speechSynthesis.resume();

  const voices = await loadVoices();
  if (gen !== speakGeneration) return false;

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.lang = langCode;
    const voice = pickVoice(voices, langCode);
    if (voice) utterance.voice = voice;

    const audio = getAudioSettings();
    const isJa = langCode.toLowerCase().startsWith("ja");

    utterance.volume = audio.ttsVolume;
    if (isJa && audio.jaClarityBoost) {
      utterance.rate = 0.88;
      utterance.pitch = 1.06;
    } else {
      utterance.rate = isJa ? 0.95 : 1;
      utterance.pitch = 1;
    }

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

    // Một số trình duyệt không kích hoạt onstart nếu bị chặn autoplay
    window.setTimeout(() => {
      if (settled || gen !== speakGeneration) return;
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        finish(true);
      }
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
): Promise<boolean> {
  return speakTranslation(text, targetLang(direction));
}

export function cancelSpeech(): void {
  speakGeneration++;
  if (isTTSSupported()) speechSynthesis.cancel();
}
