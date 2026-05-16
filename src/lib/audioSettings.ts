import type { SpeechPlaybackMode } from "@/lib/speechPlayback";

export type AudioSettings = {
  playbackMode: SpeechPlaybackMode;
  /** 0–100 */
  ttsVolume: number;
  /** 70–130 (% tốc độ đọc) */
  ttsSpeed: number;
  /** Tối ưu phát âm tiếng Nhật (chậm hơn, rõ hơn) */
  japaneseClarity: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /** Lọc ồn nền / âm trầm môi trường */
  ambientNoiseFilter: boolean;
  /** 0–100 — mức lọc tiếng ồn */
  noiseFilterStrength: number;
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  playbackMode: "headphones",
  ttsVolume: 100,
  ttsSpeed: 100,
  japaneseClarity: true,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  ambientNoiseFilter: true,
  noiseFilterStrength: 65,
};

const STORAGE_KEY = "vietnhat-audio-settings";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function loadAudioSettings(): AudioSettings {
  if (typeof window === "undefined") return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem("vietnhat-speech-playback");
      if (
        legacy === "headphones" ||
        legacy === "on" ||
        legacy === "off"
      ) {
        return { ...DEFAULT_AUDIO_SETTINGS, playbackMode: legacy };
      }
      return { ...DEFAULT_AUDIO_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      ...DEFAULT_AUDIO_SETTINGS,
      ...parsed,
      ttsVolume: clamp(Number(parsed.ttsVolume ?? 100), 30, 100),
      ttsSpeed: clamp(Number(parsed.ttsSpeed ?? 100), 70, 130),
      noiseFilterStrength: clamp(
        Number(parsed.noiseFilterStrength ?? 65),
        0,
        100,
      ),
      playbackMode:
        parsed.playbackMode === "on" ||
        parsed.playbackMode === "off" ||
        parsed.playbackMode === "headphones"
          ? parsed.playbackMode
          : DEFAULT_AUDIO_SETTINGS.playbackMode,
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export type TtsParams = {
  volume: number;
  rate: number;
  pitch: number;
};

export function ttsParamsFromSettings(
  settings: AudioSettings,
  langCode: string,
): TtsParams {
  const isJa = langCode.toLowerCase().startsWith("ja");
  const speedFactor = settings.ttsSpeed / 100;
  let rate = speedFactor;
  let pitch = 1;

  if (isJa && settings.japaneseClarity) {
    rate = speedFactor * 0.92;
    pitch = 1.04;
  }

  return {
    volume: clamp(settings.ttsVolume / 100, 0.3, 1),
    rate: clamp(rate, 0.7, 1.35),
    pitch: clamp(pitch, 0.9, 1.15),
  };
}
