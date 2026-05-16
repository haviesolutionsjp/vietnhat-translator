export type SpeechPlaybackMode = "headphones" | "on" | "off";

export type AudioSettings = {
  playbackMode: SpeechPlaybackMode;
  /** 0–1 */
  ttsVolume: number;
  /** 0.7–1.4 */
  ttsRate: number;
  /** TTS tiếng Nhật chậm & rõ hơn */
  jaClarityBoost: boolean;
  micNoiseSuppression: boolean;
  micEchoCancellation: boolean;
  micAutoGain: boolean;
  /** 0–100: lọc tần thấp / ồn nền */
  micNoiseFilter: number;
  /** 0–100: giảm ồn môi trường (dải trầm) */
  micEnvironmentReduction: number;
};

const STORAGE_KEY = "vietnhat-audio-settings";

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  playbackMode: "headphones",
  ttsVolume: 1,
  ttsRate: 1,
  jaClarityBoost: true,
  micNoiseSuppression: true,
  micEchoCancellation: true,
  micAutoGain: true,
  micNoiseFilter: 55,
  micEnvironmentReduction: 45,
};

let cache: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };

export function getAudioSettings(): AudioSettings {
  return cache;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalize(raw: Partial<AudioSettings>): AudioSettings {
  return {
    playbackMode:
      raw.playbackMode === "on" ||
      raw.playbackMode === "off" ||
      raw.playbackMode === "headphones"
        ? raw.playbackMode
        : DEFAULT_AUDIO_SETTINGS.playbackMode,
    ttsVolume: clamp(
      typeof raw.ttsVolume === "number" ? raw.ttsVolume : DEFAULT_AUDIO_SETTINGS.ttsVolume,
      0.2,
      1,
    ),
    ttsRate: clamp(
      typeof raw.ttsRate === "number" ? raw.ttsRate : DEFAULT_AUDIO_SETTINGS.ttsRate,
      0.7,
      1.4,
    ),
    jaClarityBoost:
      typeof raw.jaClarityBoost === "boolean"
        ? raw.jaClarityBoost
        : DEFAULT_AUDIO_SETTINGS.jaClarityBoost,
    micNoiseSuppression:
      typeof raw.micNoiseSuppression === "boolean"
        ? raw.micNoiseSuppression
        : DEFAULT_AUDIO_SETTINGS.micNoiseSuppression,
    micEchoCancellation:
      typeof raw.micEchoCancellation === "boolean"
        ? raw.micEchoCancellation
        : DEFAULT_AUDIO_SETTINGS.micEchoCancellation,
    micAutoGain:
      typeof raw.micAutoGain === "boolean"
        ? raw.micAutoGain
        : DEFAULT_AUDIO_SETTINGS.micAutoGain,
    micNoiseFilter: clamp(
      typeof raw.micNoiseFilter === "number"
        ? raw.micNoiseFilter
        : DEFAULT_AUDIO_SETTINGS.micNoiseFilter,
      0,
      100,
    ),
    micEnvironmentReduction: clamp(
      typeof raw.micEnvironmentReduction === "number"
        ? raw.micEnvironmentReduction
        : DEFAULT_AUDIO_SETTINGS.micEnvironmentReduction,
      0,
      100,
    ),
  };
}

export function loadAudioSettings(): AudioSettings {
  if (typeof window === "undefined") return { ...DEFAULT_AUDIO_SETTINGS };

  try {
    const legacy = localStorage.getItem("vietnhat-speech-playback");
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Partial<AudioSettings>)
      : legacy
        ? { playbackMode: legacy as SpeechPlaybackMode }
        : {};

    cache = normalize({ ...DEFAULT_AUDIO_SETTINGS, ...parsed });
  } catch {
    cache = { ...DEFAULT_AUDIO_SETTINGS };
  }

  return cache;
}

export function saveAudioSettings(settings: AudioSettings): void {
  cache = normalize(settings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
}

/** Tăng lọc khi đang nghe tiếng Nhật (nhận dạng ja) */
export function micSettingsForSource(
  base: AudioSettings,
  sourceIsJapanese: boolean,
): AudioSettings {
  if (!sourceIsJapanese) return base;
  return {
    ...base,
    micNoiseFilter: clamp(base.micNoiseFilter + 15, 0, 100),
    micEnvironmentReduction: clamp(base.micEnvironmentReduction + 15, 0, 100),
  };
}
