"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DirectionPicker } from "@/components/DirectionPicker";
import {
  listenHint,
  resolveDirection,
  sourceLang,
  targetLang,
  type Direction,
  type DirectionMode,
} from "@/lib/lang";
import { createRecognition, isSpeechRecognitionSupported } from "@/lib/speechRecognition";
import {
  resetTranslatorCache,
  translateText,
  warmTranslators,
} from "@/lib/translate";
import { cancelSpeech, speakTranslation } from "@/lib/tts";

type Status = "idle" | "listening" | "translating" | "speaking";

const SILENCE_MS_JA = 850;
const SILENCE_MS_VI = 550;

function recognitionLang(mode: DirectionMode, detected: Direction | null): string {
  if (mode === "vi-ja") return sourceLang("vi-ja");
  if (mode === "ja-vi") return sourceLang("ja-vi");
  return sourceLang(detected ?? "vi-ja");
}

function silenceMsFor(direction: Direction): number {
  return direction === "ja-vi" ? SILENCE_MS_JA : SILENCE_MS_VI;
}

export function TranslatorApp() {
  const [mode, setMode] = useState<DirectionMode>("vi-ja");
  const [detectedDirection, setDetectedDirection] = useState<Direction | null>(
    null,
  );
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [lastTranslation, setLastTranslation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const listeningRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const modeRef = useRef(mode);
  const detectedRef = useRef<Direction | null>(null);
  const lastTranslatedRef = useRef("");
  const lastTranslatedDirRef = useRef<Direction | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableTextRef = useRef("");
  const stableSinceRef = useRef(0);

  modeRef.current = mode;
  detectedRef.current = detectedDirection;
  listeningRef.current = listening;

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    setStatus("idle");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, []);

  const applyRecognitionLang = useCallback(
    (recognition: SpeechRecognition, lang: string) => {
      if (recognition.lang !== lang) {
        recognition.lang = lang;
      }
    },
    [],
  );

  const maybeSwitchAutoLang = useCallback(
    (text: string) => {
      if (modeRef.current !== "auto") return;
      const resolved = resolveDirection("auto", text);
      if (detectedRef.current === resolved) return;

      setDetectedDirection(resolved);
      detectedRef.current = resolved;

      const recognition = recognitionRef.current;
      if (recognition && listeningRef.current) {
        const lang = sourceLang(resolved);
        applyRecognitionLang(recognition, lang);
        try {
          recognition.stop();
        } catch {
          /* ignore */
        }
      }
    },
    [applyRecognitionLang],
  );

  const runTranslation = useCallback(async (sourceText: string) => {
    const trimmed = sourceText.trim();
    if (!trimmed) return;

    const direction = resolveDirection(modeRef.current, trimmed);
    setDetectedDirection(direction);

    const dedupeKey = `${direction}:${trimmed}`;
    if (dedupeKey === `${lastTranslatedDirRef.current}:${lastTranslatedRef.current}`) {
      return;
    }

    setStatus("translating");
    setError(null);

    try {
      const translated = await translateText(trimmed, direction);
      if (!translated) return;

      lastTranslatedRef.current = trimmed;
      lastTranslatedDirRef.current = direction;
      setLastTranslation(translated);
      setStatus("speaking");
      cancelSpeech();
      await speakTranslation(translated, targetLang(direction));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không dịch được");
    } finally {
      if (listeningRef.current) setStatus("listening");
      else setStatus("idle");
    }
  }, []);

  const scheduleTranslation = useCallback(
    (text: string, isFinal: boolean) => {
      maybeSwitchAutoLang(text);
      const direction = resolveDirection(modeRef.current, text);
      const silenceMs = silenceMsFor(direction);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (isFinal) {
        void runTranslation(text);
        stableTextRef.current = "";
        return;
      }

      const now = Date.now();
      if (text !== stableTextRef.current) {
        stableTextRef.current = text;
        stableSinceRef.current = now;
      }

      debounceRef.current = setTimeout(() => {
        const stableFor = Date.now() - stableSinceRef.current;
        const stable = stableTextRef.current.trim();
        const dir = resolveDirection(modeRef.current, stable);
        const key = `${dir}:${stable}`;
        if (
          stable &&
          stableFor >= silenceMs &&
          key !== `${lastTranslatedDirRef.current}:${lastTranslatedRef.current}`
        ) {
          void runTranslation(stable);
        }
      }, silenceMs);
    },
    [maybeSwitchAutoLang, runTranslation],
  );

  const bindRecognitionHandlers = useCallback(
    (recognition: SpeechRecognition) => {
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        let finalText = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) finalText += transcript;
          else interim += transcript;
        }

        const combined = (finalText || interim).trim();
        if (!combined) return;

        if (finalText) scheduleTranslation(finalText, true);
        else scheduleTranslation(combined, false);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === "aborted" || event.error === "no-speech") return;
        if (event.error === "not-allowed") {
          setError("Cần quyền micro. Bật trong cài đặt trình duyệt.");
          stopListening();
          return;
        }
        setError(`Lỗi mic: ${event.error}`);
      };

      recognition.onend = () => {
        if (listeningRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch {
            /* already started */
          }
        }
      };
    },
    [scheduleTranslation, stopListening],
  );

  const startRecognition = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      setSupported(false);
      setError("Dùng Chrome trên Android để nhận dạng giọng nói.");
      return;
    }

    try {
      const initialDetected =
        modeRef.current === "ja-vi"
          ? "ja-vi"
          : modeRef.current === "vi-ja"
            ? "vi-ja"
            : null;

      if (modeRef.current === "auto") {
        setDetectedDirection(null);
        detectedRef.current = null;
      } else {
        setDetectedDirection(initialDetected);
        detectedRef.current = initialDetected;
      }

      const recognition = createRecognition(
        initialDetected ?? "vi-ja",
      );
      recognition.lang = recognitionLang(modeRef.current, initialDetected);
      recognitionRef.current = recognition;
      bindRecognitionHandlers(recognition);

      recognition.start();
      setListening(true);
      listeningRef.current = true;
      setStatus("listening");
      setError(null);
      lastTranslatedRef.current = "";
      lastTranslatedDirRef.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không bật được micro");
      stopListening();
    }
  }, [bindRecognitionHandlers, stopListening]);

  const toggleListening = useCallback(() => {
    if (listening) {
      stopListening();
      cancelSpeech();
      return;
    }
    setLastTranslation("");
    lastTranslatedRef.current = "";
    lastTranslatedDirRef.current = null;
    startRecognition();
  }, [listening, startRecognition, stopListening]);

  const changeMode = useCallback(
    (next: DirectionMode) => {
      const wasListening = listening;
      if (wasListening) stopListening();

      setMode(next);
      modeRef.current = next;
      setDetectedDirection(null);
      detectedRef.current = null;
      setLastTranslation("");
      lastTranslatedRef.current = "";
      lastTranslatedDirRef.current = null;

      if (wasListening) {
        setTimeout(() => startRecognition(), 300);
      }
    },
    [listening, startRecognition, stopListening],
  );

  useEffect(() => {
    setSupported(isSpeechRecognitionSupported());
    void warmTranslators();
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && listeningRef.current) {
        stopListening();
        cancelSpeech();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stopListening]);

  useEffect(() => {
    return () => {
      stopListening();
      cancelSpeech();
      resetTranslatorCache();
    };
  }, [stopListening]);

  const activeDirection =
    mode === "auto"
      ? detectedDirection
      : mode;

  const statusLabel =
    status === "listening"
      ? mode === "auto"
        ? detectedDirection
          ? `${listenHint(detectedDirection)}…`
          : "Đang nghe (Việt hoặc Nhật)…"
        : `${listenHint(mode)}…`
      : status === "translating"
        ? "Đang dịch…"
        : status === "speaking"
          ? "Đang đọc bản dịch"
          : listening
            ? "Đang nghe…"
            : "Chạm để nghe";

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-between bg-[#0c0f14] px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-zinc-100">
      <header className="flex w-full max-w-md flex-col items-center gap-4">
        <h1 className="text-lg font-medium tracking-tight text-zinc-400">
          Việt ↔ Nhật
        </h1>
        <DirectionPicker
          mode={mode}
          activeDirection={activeDirection}
          disabled={status === "translating"}
          onChange={changeMode}
        />
        <p className="text-center text-xs text-zinc-500">
          Hai chiều: Việt→Nhật · Nhật→Việt · Tự động
        </p>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8">
        <p
          className="min-h-[1.25rem] text-center text-sm text-zinc-500"
          aria-live="polite"
        >
          {statusLabel}
        </p>

        <button
          type="button"
          onClick={toggleListening}
          disabled={!supported}
          aria-pressed={listening}
          aria-label={listening ? "Tắt nghe" : "Bật nghe và dịch"}
          className={`relative flex h-40 w-40 items-center justify-center rounded-full text-xl font-semibold shadow-lg transition-all active:scale-95 disabled:opacity-40 ${
            listening
              ? "bg-red-600 text-white shadow-red-900/40 ring-4 ring-red-500/30"
              : "bg-emerald-600 text-white shadow-emerald-900/40 hover:bg-emerald-500"
          }`}
        >
          {listening ? (
            <span className="flex flex-col items-center gap-1">
              <MicPulse />
              Tắt
            </span>
          ) : (
            "Nói"
          )}
        </button>

        {lastTranslation ? (
          <p
            className="max-w-sm text-center text-base text-zinc-400"
            aria-live="polite"
          >
            {lastTranslation}
          </p>
        ) : (
          <p className="max-w-xs text-center text-xs text-zinc-600">
            Bản dịch đọc tự động · chọn chiều hoặc Tự động
          </p>
        )}
      </main>

      {error ? (
        <p className="max-w-md text-center text-sm text-amber-400/90" role="alert">
          {error}
        </p>
      ) : !supported ? (
        <p className="max-w-md text-center text-sm text-amber-400/90">
          Cần Chrome hoặc Edge trên điện thoại Android để dùng micro.
        </p>
      ) : null}
    </div>
  );
}

function MicPulse() {
  return (
    <span className="relative flex h-3 w-3 items-center justify-center">
      <span className="absolute h-8 w-8 animate-ping rounded-full bg-white/20" />
      <span className="relative h-2 w-2 rounded-full bg-white" />
    </span>
  );
}
