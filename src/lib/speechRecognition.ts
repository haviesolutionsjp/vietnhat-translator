import { sourceLang, type Direction } from "@/lib/lang";

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.SpeechRecognition ?? window.webkitSpeechRecognition,
  );
}

export function createRecognition(direction: Direction): SpeechRecognition {
  const Ctor =
    window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Ctor) throw new Error("Trình duyệt không hỗ trợ nhận dạng giọng nói");

  const recognition = new Ctor();
  recognition.lang = sourceLang(direction);
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  return recognition;
}
