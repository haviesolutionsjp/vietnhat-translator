import {
  type Direction,
  myMemoryPair,
  translatorCodes,
} from "@/lib/lang";

const translatorCache = new Map<Direction, TranslatorInstance>();
const resultCache = new Map<string, string>();
const MAX_CACHE = 80;

const CHROME_TIMEOUT_MS = 700;

function cacheKey(direction: Direction, text: string): string {
  return `${direction}\0${text}`;
}

function remember(direction: Direction, source: string, translated: string): string {
  const key = cacheKey(direction, source);
  if (resultCache.size >= MAX_CACHE) {
    const first = resultCache.keys().next().value;
    if (first) resultCache.delete(first);
  }
  resultCache.set(key, translated);
  return translated;
}

async function getChromeTranslator(
  direction: Direction,
): Promise<TranslatorInstance | null> {
  const Translator = window.Translator;
  if (!Translator) return null;

  const cached = translatorCache.get(direction);
  if (cached) return cached;

  const { source, target } = translatorCodes(direction);
  try {
    const availability = await Translator.availability({
      sourceLanguage: source,
      targetLanguage: target,
    });
    if (availability === "unavailable") return null;

    const instance = await Translator.create({
      sourceLanguage: source,
      targetLanguage: target,
    });
    translatorCache.set(direction, instance);
    return instance;
  } catch {
    return null;
  }
}

async function translateChrome(
  text: string,
  direction: Direction,
): Promise<string | null> {
  const chrome = await getChromeTranslator(direction);
  if (!chrome) return null;
  try {
    return (await chrome.translate(text)).trim();
  } catch {
    return null;
  }
}

async function translateMyMemory(
  text: string,
  direction: Direction,
): Promise<string> {
  const pair = myMemoryPair(direction);
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", pair);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error("Dịch thất bại");
  const data = (await res.json()) as {
    responseData?: { translatedText?: string };
  };
  const translated = data.responseData?.translatedText?.trim();
  if (!translated) throw new Error("Không nhận được bản dịch");
  return translated;
}

export async function translateText(
  text: string,
  direction: Direction,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const hit = resultCache.get(cacheKey(direction, trimmed));
  if (hit) return hit;

  const chromeFast = translateChrome(trimmed, direction);
  const chromeResult = await Promise.race([
    chromeFast,
    new Promise<null>((resolve) =>
      window.setTimeout(() => resolve(null), CHROME_TIMEOUT_MS),
    ),
  ]);

  if (chromeResult) {
    return remember(direction, trimmed, chromeResult);
  }

  const pending = chromeFast.catch(() => null);
  const myMemory = translateMyMemory(trimmed, direction);

  const [lateChrome, mm] = await Promise.all([pending, myMemory]);
  if (lateChrome) {
    return remember(direction, trimmed, lateChrome);
  }

  return remember(direction, trimmed, mm);
}

/** Khởi tạo sẵn cả hai chiều (Chrome Translator) */
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
  resultCache.clear();
}
