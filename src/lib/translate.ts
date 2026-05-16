import {
  type Direction,
  myMemoryPair,
  translatorCodes,
} from "@/lib/lang";

const translatorCache = new Map<Direction, TranslatorInstance>();
const translatorInflight = new Map<Direction, Promise<TranslatorInstance | null>>();
const translatorUnavailableUntil = new Map<Direction, number>();
const resultCache = new Map<string, string>();
const MAX_CACHE = 80;

const CHROME_EARLY_WAIT_MS = 260;
const MYMEMORY_HEDGE_DELAY_MS = 220;
const TRANSLATOR_UNAVAILABLE_RETRY_MS = 45_000;
const TRANSLATOR_CREATE_RETRY_MS = 8_000;

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function blockTranslator(direction: Direction, durationMs: number): void {
  translatorUnavailableUntil.set(direction, Date.now() + durationMs);
}

async function getChromeTranslator(
  direction: Direction,
): Promise<TranslatorInstance | null> {
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
    wait(CHROME_EARLY_WAIT_MS).then(() => null as string | null),
  ]);

  if (chromeResult) {
    return remember(direction, trimmed, chromeResult);
  }

  const myMemoryHedged = wait(MYMEMORY_HEDGE_DELAY_MS)
    .then(() => translateMyMemory(trimmed, direction))
    .catch(() => null as string | null);

  const firstWinner = await Promise.race([chromeFast, myMemoryHedged]);
  if (firstWinner) {
    return remember(direction, trimmed, firstWinner);
  }

  const [lateChrome, hedgedMemory] = await Promise.all([chromeFast, myMemoryHedged]);
  if (lateChrome) {
    return remember(direction, trimmed, lateChrome);
  }
  if (hedgedMemory) {
    return remember(direction, trimmed, hedgedMemory);
  }

  const mm = await translateMyMemory(trimmed, direction);
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
  translatorInflight.clear();
  translatorUnavailableUntil.clear();
  resultCache.clear();
}
