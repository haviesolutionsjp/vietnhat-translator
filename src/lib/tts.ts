let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesReady) return voicesReady;

  voicesReady = new Promise((resolve) => {
    const pick = () => {
      const list = speechSynthesis.getVoices();
      if (list.length > 0) resolve(list);
    };
    pick();
    speechSynthesis.onvoiceschanged = () => {
      pick();
    };
    setTimeout(() => resolve(speechSynthesis.getVoices()), 500);
  });

  return voicesReady;
}

function pickVoice(
  voices: SpeechSynthesisVoice[],
  langPrefix: string,
): SpeechSynthesisVoice | undefined {
  const prefix = langPrefix.toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === prefix) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix.slice(0, 2))) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
  );
}

let speakGeneration = 0;

export async function speakTranslation(
  text: string,
  lang: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || !("speechSynthesis" in window)) return;

  const gen = ++speakGeneration;
  speechSynthesis.cancel();

  const voices = await loadVoices();
  if (gen !== speakGeneration) return;

  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.lang = lang;
  const voice = pickVoice(voices, lang);
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  utterance.pitch = 1;

  return new Promise((resolve) => {
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
}

export function cancelSpeech(): void {
  speakGeneration++;
  speechSynthesis.cancel();
}
