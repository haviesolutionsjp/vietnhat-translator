"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DirectionPicker } from "@/components/DirectionPicker";
import { SpeechPlaybackPicker } from "@/components/SpeechPlaybackPicker";
import { TargetSpeech } from "@/components/TargetSpeech";
import { useAudioOutput } from "@/hooks/useAudioOutput";
import {
  listenHint,
  resolveDirection,
  sourceLang,
  type Direction,
  type DirectionMode,
} from "@/lib/lang";
import {
  createRecognition,
  isRetriableSpeechError,
  isSecureMicContext,
  isSpeechRecognitionSupported,
  speechErrorMessage,
} from "@/lib/speechRecognition";
import {
  resetTranslatorCache,
  translateText,
  warmTranslators,
} from "@/lib/translate";
import {
  loadSpeechPlaybackMode,
  saveSpeechPlaybackMode,
  shouldAutoPlaySpeech,
  type SpeechPlaybackMode,
} from "@/lib/speechPlayback";
import { cancelSpeech, prepareVoices, speakForDirection } from "@/lib/tts";

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
  const [lastSpeakDirection, setLastSpeakDirection] = useState<Direction>("vi-ja");
  const [playbackMode, setPlaybackMode] =
    useState<SpeechPlaybackMode>("headphones");
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [supported, setSupported] = useState(false);

  const {
    headphonesConnected,
    ready: audioOutputReady,
    refresh: refreshAudioOutput,
  } = useAudioOutput();

  const listeningRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const modeRef = useRef(mode);
  const detectedRef = useRef<Direction | null>(null);
  const lastTranslatedRef = useRef("");
  const lastTranslatedDirRef = useRef<Direction | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableTextRef = useRef("");
  const stableSinceRef = useRef(0);
  const networkRetriesRef = useRef(0);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackModeRef = useRef(playbackMode);
  const headphonesRef = useRef(headphonesConnected);
  const prevHeadphonesRef = useRef(false);

  modeRef.current = mode;
  detectedRef.current = detectedDirection;
  listeningRef.current = listening;
  playbackModeRef.current = playbackMode;
  headphonesRef.current = headphonesConnected;

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    setStatus("idle");
    networkRetriesRef.current = 0;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, []);

  const scheduleRecognitionRestart = useCallback((delayMs: number) => {
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    restartTimeoutRef.current = setTimeout(() => {
      if (!listeningRef.current || !recognitionRef.current) return;
      try {
        recognitionRef.current.start();
      } catch {
        scheduleRecognitionRestart(Math.min(delayMs * 2, 3000));
      }
    }, delayMs);
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
        scheduleRecognitionRestart(400);
      }
    },
    [applyRecognitionLang, scheduleRecognitionRestart],
  );

  const playTranslation = useCallback(
    async (translated: string, direction: Direction) => {
      if (
        !shouldAutoPlaySpeech(
          playbackModeRef.current,
          headphonesRef.current,
        )
      ) {
        return;
      }
      setStatus("speaking");
      cancelSpeech();
      prepareVoices();
      await speakForDirection(translated, direction);
    },
    [],
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
      setLastSpeakDirection(direction);
      setLastTranslation(translated);
      await playTranslation(translated, direction);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không dịch được");
    } finally {
      if (listeningRef.current) setStatus("listening");
      else setStatus("idle");
    }
  }, [playTranslation]);

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
      recognition.onstart = () => {
        networkRetriesRef.current = 0;
        setError(null);
      };

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
        const code = event.error;
        if (code === "aborted" || code === "no-speech") return;

        if (isRetriableSpeechError(code) && listeningRef.current) {
          networkRetriesRef.current += 1;
          const canRetry = networkRetriesRef.current <= 6;
          const msg = speechErrorMessage(code, canRetry);
          if (msg) setError(msg);

          if (canRetry) {
            try {
              recognition.stop();
            } catch {
              /* ignore */
            }
            scheduleRecognitionRestart(
              Math.min(400 * networkRetriesRef.current, 2500),
            );
            return;
          }

          stopListening();
          return;
        }

        if (code === "not-allowed" || code === "service-not-allowed") {
          setError(
            speechErrorMessage(code, false) ??
              "Cần quyền micro. Bật trong cài đặt trình duyệt.",
          );
          stopListening();
          return;
        }

        const message = speechErrorMessage(code, false);
        if (message) setError(message);
        if (code !== "network") stopListening();
      };

      recognition.onend = () => {
        if (listeningRef.current && recognitionRef.current) {
          scheduleRecognitionRestart(250);
        }
      };
    },
    [scheduleRecognitionRestart, scheduleTranslation, stopListening],
  );

  const startRecognition = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      setSupported(false);
      setError("Dùng Chrome trên Android để nhận dạng giọng nói.");
      return;
    }

    if (!isSecureMicContext()) {
      setError(
        "Micro cần kết nối an toàn (HTTPS). Mở qua localhost hoặc deploy HTTPS, không dùng IP mạng nội bộ http.",
      );
      return;
    }

    try {
      networkRetriesRef.current = 0;
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
      void refreshAudioOutput();
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
  }, [bindRecognitionHandlers, refreshAudioOutput, stopListening]);

  const toggleListening = useCallback(() => {
    if (listening) {
      stopListening();
      cancelSpeech();
      return;
    }
    prepareVoices();
    setLastTranslation("");
    lastTranslatedRef.current = "";
    lastTranslatedDirRef.current = null;
    startRecognition();
  }, [listening, startRecognition, stopListening]);

  const changeMode = useCallback(
    (next: DirectionMode) => {
      if (next === modeRef.current) return;

      const wasListening = listeningRef.current;
      if (wasListening) stopListening();

      modeRef.current = next;
      setMode(next);
      setDetectedDirection(null);
      detectedRef.current = null;
      setLastTranslation("");
      lastTranslatedRef.current = "";
      lastTranslatedDirRef.current = null;
      setError(null);

      if (wasListening) {
        window.setTimeout(() => startRecognition(), 300);
      }
    },
    [startRecognition, stopListening],
  );

  useEffect(() => {
    setMounted(true);
    setPlaybackMode(loadSpeechPlaybackMode());
    setSupported(isSpeechRecognitionSupported());
    prepareVoices();
    void warmTranslators();
  }, []);

  useEffect(() => {
    if (!audioOutputReady) return;

    const wasConnected = prevHeadphonesRef.current;
    prevHeadphonesRef.current = headphonesConnected;

    if (
      !wasConnected &&
      headphonesConnected &&
      shouldAutoPlaySpeech(playbackModeRef.current, true)
    ) {
      prepareVoices();
      const text = lastTranslation;
      const dir = lastTranslatedDirRef.current;
      if (text && dir) {
        void (async () => {
          setStatus("speaking");
          cancelSpeech();
          await speakForDirection(text, dir);
          if (listeningRef.current) setStatus("listening");
          else setStatus("idle");
        })();
      }
    }
  }, [headphonesConnected, audioOutputReady, lastTranslation]);

  const changePlaybackMode = useCallback((next: SpeechPlaybackMode) => {
    if (next === playbackModeRef.current) return;
    playbackModeRef.current = next;
    setPlaybackMode(next);
    saveSpeechPlaybackMode(next);

    if (next === "off") cancelSpeech();

    if (
      next === "on" &&
      lastTranslation &&
      lastTranslatedDirRef.current
    ) {
      void playTranslation(lastTranslation, lastTranslatedDirRef.current);
    }
  }, [lastTranslation, playTranslation]);

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
      <header className="relative z-20 flex w-full max-w-md shrink-0 flex-col items-center gap-4">
        <h1 className="text-lg font-medium tracking-tight text-zinc-400">
          Việt ↔ Nhật
        </h1>
        <DirectionPicker
          mode={mode}
          activeDirection={activeDirection}
          onChange={changeMode}
        />
        <SpeechPlaybackPicker
          mode={playbackMode}
          headphonesConnected={headphonesConnected}
          onChange={changePlaybackMode}
        />
      </header>

      <main className="relative z-0 flex min-h-0 flex-1 flex-col items-center justify-center gap-8">
        <p
          className="min-h-[1.25rem] text-center text-sm text-zinc-500"
          aria-live="polite"
        >
          {statusLabel}
        </p>

        <button
          type="button"
          onClick={toggleListening}
          disabled={mounted && !supported}
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
          <TargetSpeech
            text={lastTranslation}
            direction={lastSpeakDirection}
            speaking={status === "speaking"}
            onSpeakingChange={(speaking) => {
              if (speaking) setStatus("speaking");
              else if (listeningRef.current) setStatus("listening");
              else setStatus("idle");
            }}
          />
        ) : (
          <p className="max-w-xs text-center text-xs text-zinc-600">
            {playbackMode === "off"
              ? "Phát âm tắt — bấm Nghe để nghe bản dịch"
              : playbackMode === "headphones" && !headphonesConnected
                ? "Cắm tai nghe để tự phát âm sau khi dịch"
                : "Bản dịch tự phát âm · bấm Nghe để nghe lại"}
          </p>
        )}
      </main>

      {error ? (
        <p className="max-w-md text-center text-sm text-amber-400/90" role="alert">
          {error}
        </p>
      ) : mounted && !supported ? (
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
