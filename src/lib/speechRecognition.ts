import { sourceLang, type Direction } from "@/lib/lang";

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.SpeechRecognition ?? window.webkitSpeechRecognition,
  );
}

export function isSecureMicContext(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext;
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

/** Thông báo lỗi tiếng Việt cho SpeechRecognitionErrorEvent */
export function speechErrorMessage(
  code: string,
  retriesLeft: boolean,
): string | null {
  switch (code) {
    case "aborted":
    case "no-speech":
      return null;
    case "network":
      return retriesLeft
        ? "Mạng chập chờn — đang kết nối lại nhận dạng giọng…"
        : "Không kết nối được dịch vụ nhận dạng. Kiểm tra internet hoặc thử lại.";
    case "not-allowed":
    case "service-not-allowed":
      return "Cần quyền micro. Bật trong cài đặt trình duyệt.";
    case "audio-capture":
      return "Không truy cập được micro. Kiểm tra thiết bị âm thanh.";
    case "language-not-supported":
      return "Trình duyệt chưa hỗ trợ nhận dạng ngôn ngữ này.";
    default:
      return `Lỗi nhận dạng giọng (${code}). Thử tắt/bật lại nút Nói.`;
  }
}

export function isRetriableSpeechError(code: string): boolean {
  return code === "network" || code === "service-not-available";
}
