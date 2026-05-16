export type SpeechPlaybackMode = "headphones" | "on" | "off";

const STORAGE_KEY = "vietnhat-speech-playback";

export const SPEECH_PLAYBACK_OPTIONS: {
  mode: SpeechPlaybackMode;
  label: string;
  short: string;
}[] = [
  { mode: "headphones", label: "Tự động (tai nghe)", short: "Tai nghe" },
  { mode: "on", label: "Luôn phát", short: "Bật" },
  { mode: "off", label: "Không tự phát", short: "Tắt" },
];

export function loadSpeechPlaybackMode(): SpeechPlaybackMode {
  if (typeof window === "undefined") return "headphones";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "headphones" || saved === "on" || saved === "off") return saved;
  return "headphones";
}

export function saveSpeechPlaybackMode(mode: SpeechPlaybackMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
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
