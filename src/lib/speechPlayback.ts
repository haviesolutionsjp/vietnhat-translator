import {
  getAudioSettings,
  loadAudioSettings,
  saveAudioSettings,
} from "@/lib/audioSettings";
import type { SpeechPlaybackMode } from "@/lib/audioSettings";

export type { SpeechPlaybackMode };

export const SPEECH_PLAYBACK_OPTIONS = [
  { mode: "headphones" as const, label: "Tự động (tai nghe)", short: "Tai nghe" },
  { mode: "on" as const, label: "Luôn phát", short: "Bật" },
  { mode: "off" as const, label: "Không tự phát", short: "Tắt" },
];

export function loadSpeechPlaybackMode(): SpeechPlaybackMode {
  return loadAudioSettings().playbackMode;
}

export function saveSpeechPlaybackMode(mode: SpeechPlaybackMode): void {
  const s = getAudioSettings();
  saveAudioSettings({ ...s, playbackMode: mode });
}

export function shouldAutoPlaySpeech(
  mode: SpeechPlaybackMode,
  headphonesConnected: boolean,
): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return headphonesConnected;
}

export function speechPlaybackHint(
  mode: SpeechPlaybackMode,
  headphonesConnected: boolean,
): string {
  if (mode === "on") return "Tự phát âm bản dịch";
  if (mode === "off") return "Chỉ phát khi bấm Nghe";
  if (headphonesConnected) return "Tai nghe đã kết nối — tự phát âm";
  return "Cắm tai nghe để tự phát âm bản dịch";
}
