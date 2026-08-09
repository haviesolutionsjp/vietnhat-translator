import {
  type Direction,
  myMemoryPair,
  translatorCodes,
} from "@/lib/lang";

const translatorCache = new Map<Direction, TranslatorInstance>();
const translatorInflight = new Map<Direction, Promise<TranslatorInstance | null>>();
const translatorUnavailableUntil = new Map<Direction, number>();
const resultCache = new Map<string, string>();
const resultInflight = new Map<string, Promise<string>>();
const MAX_CACHE = 100;

const CHROME_EARLY_WAIT_MS = 120;
const TRANSLATOR_UNAVAILABLE_RETRY_MS = 45_000;
const TRANSLATOR_CREATE_RETRY_MS = 8_000;

function cacheKey(direction: Direction, text: string): string {
  return `${direction}\0${text.trim().toLowerCase()}`;
}

function decodeHtmlEntities(text: string): string {
  const map: Record<string, string> = {
    "&quot;": '"',
    "&amp;": "&",
    "&apos;": "'",
    "&#39;": "'",
    "&#039;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&nbsp;": " ",
  };
  return text.replace(/&(quot|amp|apos|#39|#039|lt|gt|nbsp);/g, (match) => map[match] || match);
}

function remember(direction: Direction, source: string, translated: string): string {
  const key = cacheKey(direction, source);
  if (resultCache.size >= MAX_CACHE) {
    const first = resultCache.keys().next().value;
    if (first) resultCache.delete(first);
  }
  const cleaned = decodeHtmlEntities(translated).trim();
  resultCache.set(key, cleaned);
  return cleaned;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function blockTranslator(direction: Direction, durationMs: number): void {
  translatorUnavailableUntil.set(direction, Date.now() + durationMs);
}

async function getChromeTranslator(
  direction: Direction,
): Promise<TranslatorInstance | null> {
  if (typeof window === "undefined") return null;
  const Translator = window.Translator;
  if (!Translator) return null;

  const cached = translatorCache.get(direction);
  if (cached) return cached;

  const blockedUntil = translatorUnavailableUntil.get(direction) ?? 0;
  if (blockedUntil > Date.now()) return null;

  const inflight = translatorInflight.get(direction);
  if (inflight) return inflight;

  const task = (async () => {
    const { source, target } = translatorCodes(direction);
    try {
      const availability = await Translator.availability({
        sourceLanguage: source,
        targetLanguage: target,
      });
      if (availability === "unavailable") {
        blockTranslator(direction, TRANSLATOR_UNAVAILABLE_RETRY_MS);
        return null;
      }

      const instance = await Translator.create({
        sourceLanguage: source,
        targetLanguage: target,
      });
      translatorCache.set(direction, instance);
      translatorUnavailableUntil.delete(direction);
      return instance;
    } catch {
      blockTranslator(direction, TRANSLATOR_CREATE_RETRY_MS);
      return null;
    } finally {
      translatorInflight.delete(direction);
    }
  })();

  translatorInflight.set(direction, task);
  return task;
}

async function translateChrome(
  text: string,
  direction: Direction,
): Promise<string | null> {
  const chrome = await getChromeTranslator(direction);
  if (!chrome) return null;
  try {
    const res = (await chrome.translate(text)).trim();
    return res || null;
  } catch {
    return null;
  }
}

/** Google Translate endpoint (ultra-fast, highly accurate for VN ↔ JA) */
async function translateGoogle(
  text: string,
  direction: Direction,
): Promise<string> {
  const { source, target } = translatorCodes(direction);
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", source);
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) throw new Error("Google dịch không khả dụng");

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error("Dữ liệu dịch không hợp lệ");
  }

  const sentences = data[0] as Array<[string | null, ...unknown[]]>;
  const translated = sentences
    .map((item) => (item && typeof item[0] === "string" ? item[0] : ""))
    .join("")
    .trim();

  if (!translated) throw new Error("Không nhận được bản dịch");
  return decodeHtmlEntities(translated);
}

/** MyMemory API Fallback */
async function translateMyMemory(
  text: string,
  direction: Direction,
): Promise<string> {
  const pair = myMemoryPair(direction);
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", pair);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) throw new Error("Dịch thất bại");
  const data = (await res.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number;
  };
  const translated = data.responseData?.translatedText?.trim();
  if (
    !translated ||
    translated.startsWith("MYMEMORY WARNING:") ||
    translated.includes("LIMIT REACHED")
  ) {
    throw new Error("Không nhận được bản dịch MyMemory");
  }
  return decodeHtmlEntities(translated);
}

const PHONETIC_MAP: Array<[RegExp, string]> = [
  [/c[ôo][\s\-]ni[\s\-]chi[\s\-]w?a/gi, "こんにちは"],
  [/con[\s\-]ni[\s\-]chi[\s\-]w?a/gi, "こんにちは"],
  [/a[\s\-]ri[\s\-]ga[\s\-](t[ôo]|to)([\s\-]go[\s\-]zai[\s\-]ma[\s\-]s[uúíít]+)?/gi, "ありがとうございます"],
  [/[sx][ưuy][\s\-]mi[\s\-]ma[\s\-][sx]en/gi, "すみません"],
  [/[sx][ưuy][\s\-]ma[\s\-][sx]en/gi, "すみません"],
  [/ô[\s\-](ha|hai|hay)[\s\-]ô/gi, "おはよう"],
  [/g[ôo][\s\-]men([\s\-]na[\s\-]sai)?/gi, "ごめんなさい"],
  [/[đd]a[i|z][\s\-](gi[ôo]|d[ôo]|z[ôo])[\s\-]bu/gi, "大丈夫"],
  [/ô[\s\-]n[êe][\s\-]gai([\s\-]shi[\s\-]ma[\s\-]su)?/gi, "お願いします"],
  [/[đd][ôo][\s\-]c[ôo][\s\-][đd][ée]t[\s\-]ca/gi, "どこですか"],
  [/(c[ôo]|s[ôo]|a)[\s\-]r[êe][\s\-]qua/gi, "これは"],
  [/qua[\s\-]ta[\s\-]shi/gi, "私"],
  [/qua[\s\-]ca[\s\-]ri[\s\-]ma[\s\-](sen|s[íi]t|m[áa]t)/gi, "分かりません"],
  [/[sx]a[yi][\s\-]ô[\s\-]na[\s\-]ra/gi, "さようなら"],
  [/[íi]ch[\s\-]ku[\s\-]ra/gi, "いくら"],
  [/ha[\s\-]di[\s\-]m[êe][\s\-]ma[\s\-][sx]i[\s\-]t[êe]/gi, "初めまして"],
  [/[yd][ôo][\s\-]r[ôo][\s\-][sx]i[\s\-]ku/gi, "よろしく"],
];

function normalizeSource(text: string, direction: Direction): string {
  if (direction !== "ja-vi") return text;
  let normalized = text;
  for (const [regex, replacement] of PHONETIC_MAP) {
    normalized = normalized.replace(regex, replacement);
  }
  return normalized;
}

export async function translateText(
  text: string,
  direction: Direction,
): Promise<string> {
  const trimmed = normalizeSource(text.trim(), direction);
  if (!trimmed) return "";

  const key = cacheKey(direction, trimmed);
  const hit = resultCache.get(key);
  if (hit) return hit;

  const inflight = resultInflight.get(key);
  if (inflight) return inflight;

  const task = (async (): Promise<string> => {
    // 1. Check Chrome on-device Translator first if available
    const chromeFast = translateChrome(trimmed, direction);
    const chromeEarly = await Promise.race([
      chromeFast,
      wait(CHROME_EARLY_WAIT_MS).then(() => null as string | null),
    ]);
    if (chromeEarly) {
      return remember(direction, trimmed, chromeEarly);
    }

    // 2. Primary cloud translation: Google Translate GTX (fastest and most accurate for JA-VI)
    try {
      const gResult = await translateGoogle(trimmed, direction);
      if (gResult) return remember(direction, trimmed, gResult);
    } catch {
      /* Fallback to secondary */
    }

    // 3. Fallback to late Chrome if finished
    const lateChrome = await chromeFast;
    if (lateChrome) {
      return remember(direction, trimmed, lateChrome);
    }

    // 4. Secondary fallback: MyMemory
    try {
      const mm = await translateMyMemory(trimmed, direction);
      return remember(direction, trimmed, mm);
    } catch {
      throw new Error("Không thể dịch vào lúc này. Kiểm tra kết nối mạng.");
    }
  })();

  resultInflight.set(key, task);
  try {
    return await task;
  } finally {
    resultInflight.delete(key);
  }
}

/** Khởi tạo sẵn cả hai chiều (Chrome Translator nếu có) */
export async function warmTranslators(): Promise<void> {
  await Promise.all([
    getChromeTranslator("vi-ja"),
    getChromeTranslator("ja-vi"),
  ]);
}

export function resetTranslatorCache(): void {
  for (const instance of translatorCache.values()) {
    instance.destroy();
  }
  translatorCache.clear();
  translatorInflight.clear();
  translatorUnavailableUntil.clear();
  resultCache.clear();
  resultInflight.clear();
}
