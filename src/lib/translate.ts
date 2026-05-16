import {
  type Direction,
  myMemoryPair,
  translatorCodes,
} from "@/lib/lang";

const translatorCache = new Map<Direction, TranslatorInstance>();

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

async function translateMyMemory(
  text: string,
  direction: Direction,
): Promise<string> {
  const pair = myMemoryPair(direction);
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", pair);

  const res = await fetch(url.toString());
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

  const chrome = await getChromeTranslator(direction);
  if (chrome) {
    try {
      return (await chrome.translate(trimmed)).trim();
    } catch {
      /* fallback */
    }
  }

  return translateMyMemory(trimmed, direction);
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
}
