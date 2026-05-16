export type Direction = "vi-ja" | "ja-vi";
export type DirectionMode = Direction | "auto";

const JA_SCRIPT =
  /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F]/;

export function sourceLang(direction: Direction): string {
  return direction === "vi-ja" ? "vi-VN" : "ja-JP";
}

export function targetLang(direction: Direction): string {
  return direction === "vi-ja" ? "ja-JP" : "vi-VN";
}

export function myMemoryPair(direction: Direction): string {
  return direction === "vi-ja" ? "vi|ja" : "ja|vi";
}

export function translatorCodes(direction: Direction): {
  source: string;
  target: string;
} {
  return direction === "vi-ja"
    ? { source: "vi", target: "ja" }
    : { source: "ja", target: "vi" };
}

export function directionLabel(direction: Direction): string {
  return direction === "vi-ja" ? "Việt → Nhật" : "Nhật → Việt";
}

export function listenHint(direction: Direction): string {
  return direction === "vi-ja"
    ? "Đang nghe tiếng Việt"
    : "Đang nghe tiếng Nhật";
}

/** Phát hiện ngôn ngữ nguồn từ transcript để chọn chiều dịch */
export function detectDirection(text: string): Direction {
  const trimmed = text.trim();
  if (!trimmed) return "vi-ja";

  const jaMatches = trimmed.match(new RegExp(JA_SCRIPT.source, "gu"));
  const jaCount = jaMatches?.length ?? 0;
  const letterCount = trimmed.replace(/\s/g, "").length || 1;
  const jaRatio = jaCount / letterCount;

  if (jaRatio >= 0.15) return "ja-vi";
  return "vi-ja";
}

/** Gộp chế độ cố định hoặc tự động thành chiều dịch thực tế */
export function resolveDirection(
  mode: DirectionMode,
  sourceText: string,
): Direction {
  if (mode === "auto") return detectDirection(sourceText);
  return mode;
}

export const DIRECTION_OPTIONS: {
  mode: DirectionMode;
  label: string;
  short: string;
}[] = [
  { mode: "vi-ja", label: "Việt → Nhật", short: "VN → JP" },
  { mode: "ja-vi", label: "Nhật → Việt", short: "JP → VN" },
  { mode: "auto", label: "Tự động", short: "Auto" },
];
