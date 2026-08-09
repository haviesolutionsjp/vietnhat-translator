export type Direction = "vi-ja" | "ja-vi";
export type DirectionMode = Direction | "auto";

// 1. Japanese native scripts (Hiragana, Katakana, CJK Ideographs / Kanji, Halfwidth Katakana, symbols)
const JA_SCRIPT =
  /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF65-\uFF9F]/;

// 2. Vietnamese distinctive diacritics
const VI_DIACRITICS =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/;

// 3. Japanese Romaji vocabulary and phrases
const JA_ROMAJI_PATTERN = new RegExp(
  "\\b(" +
    [
      "arigato", "arigatou", "gozaimasu", "gozaimashita", "konnichiwa", "konbanwa", "ohayou", "ohayo",
      "sumimasen", "suimasen", "gomennasai", "gomen", "daijoubu", "daijobu", "sayonara", "sayounara",
      "hajimemashite", "yoroshiku", "otsukaresama", "otsukare", "itadakimasu", "gochisousama", "irasshaimase",
      "kudasai", "onegai", "onegaishimasu", "wakarimashita", "wakarimasen", "wakatta", "tasukete", "yamete",
      "chotto", "matte", "mattekudasai", "doko", "nani", "itsu", "dare", "doushite", "naze", "ikura",
      "desu", "desuka", "deshita", "masu", "masuka", "mashita", "kore", "sore", "are", "dore",
      "kono", "sono", "ano", "dono", "koko", "soko", "asoko", "watashi", "boku", "ore", "anata",
      "minna", "san", "sama", "nihon", "nihongo", "betonamu", "tokyo", "kyoto", "osaka", "shinkansen",
      "densha", "chikatetsu", "eki", "kuukou", "hoteru", "toire", "mizu", "ocha", "biiru", "gohan",
      "ramen", "tabemasu", "taberu", "nomimasu", "nomu", "ikimasu", "iku", "kimasu", "kuru", "mimasu",
      "miru", "kikimasu", "kiku", "kaimasu", "kau", "shimasu", "suru", "hai", "iie", "suki", "kirai",
      "oishii", "umai", "takai", "yasui", "samui", "atsui", "kawaii", "kakkoii", "sugoi", "yatta",
      "ganbatte", "hontou", "honto", "sou", "soudesu"
    ].join("|") +
    ")\\b",
  "i"
);

// 4. Common phonetic transcriptions of Japanese when Web Speech is in vi-VN mode
const JA_PHONETIC_VI_PATTERNS = [
  /c[ôo][\s\-]ni[\s\-]chi[\s\-]w?a/i,
  /con[\s\-]ni[\s\-]chi[\s\-]w?a/i,
  /a[\s\-]ri[\s\-]ga[\s\-](t[ôo]|to)/i,
  /[sx][ưuy][\s\-]mi[\s\-]ma[\s\-][sx]en/i,
  /[sx][ưuy][\s\-]ma[\s\-][sx]en/i,
  /ô[\s\-](ha|hai|hay)[\s\-]ô/i,
  /g[ôo][\s\-]men([\s\-]na[\s\-]sai)?/i,
  /[đd]a[i|z][\s\-](gi[ôo]|d[ôo]|z[ôo])[\s\-]bu/i,
  /ô[\s\-]n[êe][\s\-]gai/i,
  /[đd][ôo][\s\-]c[ôo][\s\-][đd][ée]t[\s\-]ca/i,
  /(c[ôo]|s[ôo]|a)[\s\-]r[êe][\s\-]qua/i,
  /qua[\s\-]ta[\s\-]shi/i,
  /qua[\s\-]ca[\s\-]ri[\s\-]ma[\s\-](sen|s[íi]t|m[áa]t)/i,
  /[sx]a[yi][\s\-]ô[\s\-]na[\s\-]ra/i,
  /[íi]ch[\s\-]ku[\s\-]ra/i,
  /ha[\s\-]di[\s\-]m[êe][\s\-]ma[\s\-][sx]i[\s\-]t[êe]/i,
  /[yd][ôo][\s\-]r[ôo][\s\-][sx]i[\s\-]ku/i,
];

// 5. Common unaccented Vietnamese vocabulary
const VI_UNACCENTED_WORDS = new Set([
  "xin", "chao", "cam", "on", "toi", "ban", "anh", "em", "ong", "ba", "chung", "minh", "muon", "hoi",
  "biet", "o", "dau", "sao", "the", "nao", "bao", "nhieu", "tien", "ga", "tau", "xe", "san", "bay",
  "an", "uong", "di", "ve", "den", "la", "gi", "khong", "chua", "roi", "duoc", "phai", "hay", "va",
  "hoac", "nhung", "vi", "nen", "neu", "tuy", "rat", "lam", "qua", "day", "do", "nay", "kia", "ai",
  "giup", "hen", "gap", "lai", "chuc", "mung", "nguoi", "viet", "nam", "tieng", "nha", "phong",
  "khach", "duong", "pho", "noi", "nghe", "doc", "viet", "hoc", "lam"
]);

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

export function targetLangName(direction: Direction): string {
  return direction === "vi-ja" ? "tiếng Nhật" : "tiếng Việt";
}

/** Phát hiện ngôn ngữ nguồn chính xác dựa trên bộ ký tự, dấu tiếng Việt, Romaji và phiên âm */
export function detectDirection(text: string): Direction {
  const trimmed = text.trim();
  if (!trimmed) return "vi-ja";

  // 1. Chữ tiếng Nhật bản địa (Kanji, Hiragana, Katakana) -> 100% tiếng Nhật
  const jaMatches = trimmed.match(new RegExp(JA_SCRIPT.source, "gu"));
  if (jaMatches && jaMatches.length > 0) {
    return "ja-vi";
  }

  // 2. Phiên âm tiếng Nhật thường gặp khi nhận dạng bằng mic tiếng Việt
  const isJaPhonetic = JA_PHONETIC_VI_PATTERNS.some((pattern) => pattern.test(trimmed));
  if (isJaPhonetic) {
    return "ja-vi";
  }

  // 3. Dấu thanh tiếng Việt -> 100% tiếng Việt
  const viDiacriticMatches = trimmed.match(new RegExp(VI_DIACRITICS.source, "gu"));
  if (viDiacriticMatches && viDiacriticMatches.length > 0) {
    return "vi-ja";
  }

  // 4. Kiểm tra từ Romaji tiếng Nhật
  const romajiMatches = trimmed.match(new RegExp(JA_ROMAJI_PATTERN.source, "gi"));
  const romajiCount = romajiMatches?.length ?? 0;

  // 5. Kiểm tra từ tiếng Việt không dấu
  const words = trimmed.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  let viWordCount = 0;
  for (const word of words) {
    if (VI_UNACCENTED_WORDS.has(word)) {
      viWordCount++;
    }
  }

  if (romajiCount > 0 && romajiCount >= viWordCount) {
    return "ja-vi";
  }

  if (viWordCount > 0) {
    return "vi-ja";
  }

  return "vi-ja";
}

/** Gộp chế độ cố định hoặc tự động thành chiều dịch thực tế */
export function resolveDirection(
  mode: DirectionMode = "auto",
  sourceText: string = "",
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
