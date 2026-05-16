"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DirectionPicker } from "@/components/DirectionPicker";
import { SettingsSheet } from "@/components/SettingsSheet";
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
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from "@/lib/audioSettings";
import { startMicEnhancer, stopMicEnhancer } from "@/lib/micSession";
import { shouldAutoPlaySpeech } from "@/lib/speechPlayback";
import { cancelSpeech, prepareVoices, speakForDirection } from "@/lib/tts";

type Status = "idle" | "listening" | "translating" | "speaking";

/** Chờ text ổn định trước khi dịch partial (ms) */
const INTERIM_STABLE_MS = 160;
const INTERIM_MIN_CHARS = 2;

function recognitionLang(mode: DirectionMode, detected: Direction | null): string {
  if (mode === "vi-ja") return sourceLang("vi-ja");
  if (mode === "ja-vi") return sourceLang("ja-vi");
  return sourceLang(detected ?? "vi-ja");
}

function minCharsFor(direction: Direction): number {
  return direction === "ja-vi" ? 1 : INTERIM_MIN_CHARS;
}

function isListeningJapanese(
  mode: DirectionMode,
  detected: Direction | null,
): boolean {
  if (mode === "ja-vi") return true;
  if (mode === "vi-ja") return false;
  return detected === "ja-vi";
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
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(
    DEFAULT_AUDIO_SETTINGS,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const audioSettingsRef = useRef(audioSettings);
  const headphonesRef = useRef(headphonesConnected);
  const prevHeadphonesRef = useRef(false);
  const translateGenRef = useRef(0);
  const lastSpokenTranslationRef = useRef("");

  modeRef.current = mode;
  detectedRef.current = detectedDirection;
  listeningRef.current = listening;
  audioSettingsRef.current = audioSettings;
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
    stopMicEnhancer();
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
    (translated: string, direction: Direction) => {
      if (
        !shouldAutoPlaySpeech(
          audioSettingsRef.current.playbackMode,
          headphonesRef.current,
        )
      ) {
        return;
      }
      if (translated === lastSpokenTranslationRef.current) return;

      lastSpokenTranslationRef.current = translated;
      setStatus("speaking");
      cancelSpeech();
      speakForDirection(translated, direction);
    },
    [],
  );

  const runTranslation = useCallback(
    async (sourceText: string, opts?: { final?: boolean }) => {
      const trimmed = sourceText.trim();
      if (trimmed.length < minCharsFor(resolveDirection(modeRef.current, trimmed))) {
        return;
      }

      const direction = resolveDirection(modeRef.current, trimmed);
      setDetectedDirection(direction);

      const dedupeKey = `${direction}:${trimmed}`;
      if (
        !opts?.final &&
        dedupeKey === `${lastTranslatedDirRef.current}:${lastTranslatedRef.current}`
      ) {
        return;
      }

      const gen = ++translateGenRef.current;
      setStatus("translating");
      setError(null);

      try {
        const translated = await translateText(trimmed, direction);
        if (gen !== translateGenRef.current || !translated) return;

        lastTranslatedRef.current = trimmed;
        lastTranslatedDirRef.current = direction;
        setLastSpeakDirection(direction);
        setLastTranslation(translated);

        playTranslation(translated, direction);

        if (listeningRef.current) {
          setStatus(
            shouldAutoPlaySpeech(
              audioSettingsRef.current.playbackMode,
              headphonesRef.current,
            )
              ? "speaking"
              : "listening",
          );
        }
      } catch (e) {
        if (gen !== translateGenRef.current) return;
        setError(e instanceof Error ? e.message : "Không dịch được");
        if (listeningRef.current) setStatus("listening");
      }
    },
    [playTranslation],
  );

  const scheduleTranslation = useCallback(
    (text: string, isFinal: boolean) => {
      maybeSwitchAutoLang(text);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (isFinal) {
        void runTranslation(text, { final: true });
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
        const minChars = minCharsFor(resolveDirection(modeRef.current, stable));
        if (stableFor >= INTERIM_STABLE_MS && stable.length >= minChars) {
          void runTranslation(stable);
        }
      }, INTERIM_STABLE_MS);
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

      void startMicEnhancer(
        isListeningJapanese(modeRef.current, initialDetected),
      );
      recognition.start();
      void refreshAudioOutput();
      setListening(true);
      listeningRef.current = true;
      setStatus("listening");
      setError(null);
      lastTranslatedRef.current = "";
      lastTranslatedDirRef.current = null;
      lastSpokenTranslationRef.current = "";
      translateGenRef.current = 0;
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
    lastSpokenTranslationRef.current = "";
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
    const loaded = loadAudioSettings();
    setAudioSettings(loaded);
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
      shouldAutoPlaySpeech(audioSettingsRef.current.playbackMode, true)
    ) {
      prepareVoices();
      const text = lastTranslation;
      const dir = lastTranslatedDirRef.current;
      if (text && dir) {
        void (async () => {
          setStatus("speaking");
          cancelSpeech();
          speakForDirection(text, dir);
          if (listeningRef.current) setStatus("speaking");
          else setStatus("idle");
        })();
      }
    }
  }, [headphonesConnected, audioOutputReady, lastTranslation]);

  const handleSettingsChange = useCallback(
    (next: AudioSettings) => {
      const prev = audioSettingsRef.current;
      saveAudioSettings(next);
      setAudioSettings(next);
      audioSettingsRef.current = next;

      if (next.playbackMode === "off") cancelSpeech();

      if (
        next.playbackMode === "on" &&
        prev.playbackMode !== "on" &&
        lastTranslation &&
        lastTranslatedDirRef.current
      ) {
        playTranslation(lastTranslation, lastTranslatedDirRef.current);
      }

      if (listeningRef.current) {
        void startMicEnhancer(
          isListeningJapanese(modeRef.current, detectedRef.current),
        );
      }
    },
    [lastTranslation, playTranslation],
  );

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
        <div className="flex w-full items-center justify-between">
          <h1 className="text-lg font-medium tracking-tight text-zinc-400">
            Việt ↔ Nhật
          </h1>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex min-h-10 items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 active:scale-[0.98]"
            aria-label="Cài đặt âm thanh"
          >
            <GearIcon />
            Cài đặt
          </button>
        </div>
        <DirectionPicker
          mode={mode}
          activeDirection={activeDirection}
          onChange={changeMode}
        />
      </header>

      <SettingsSheet
        open={settingsOpen}
        settings={audioSettings}
        headphonesConnected={headphonesConnected}
        onChange={handleSettingsChange}
        onClose={() => setSettingsOpen(false)}
      />

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
            {audioSettings.playbackMode === "off"
              ? "Phát âm tắt — bấm Nghe hoặc mở Cài đặt"
              : audioSettings.playbackMode === "headphones" &&
                  !headphonesConnected
                ? "Cắm tai nghe hoặc chỉnh trong Cài đặt"
                : "Dịch & phát âm tức thời khi bạn nói"}
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

function GearIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-zinc-400"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.5.12.98.29 1.435.507l1.36-.977a1 1 0 0 1 1.25.125l.962.962a1 1 0 0 1 .125 1.25l-.977 1.36c.217.455.387.935.507 1.435l1.473.295A1 1 0 0 1 19 10.68v1.36a1 1 0 0 1-.804.98l-1.473.295a6.77 6.77 0 0 1-.507 1.435l.977 1.36a1 1 0 0 1-.125 1.25l-.962.962a1 1 0 0 1-1.25.125l-1.36-.977c-.455.217-.935.387-1.435.507l-.295 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.77 6.77 0 0 1-1.435-.507l-1.36.977a1 1 0 0 1-1.25-.125l-.962-.962a1 1 0 0 1-.125-1.25l.977-1.36a6.77 6.77 0 0 1-.507-1.435L1.804 11.66A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.12-.5.29-.98.507-1.435l-.977-1.36a1 1 0 0 1 .125-1.25l.962-.962a1 1 0 0 1 1.25-.125l1.36.977c.455-.217.935-.387 1.435-.507l.295-1.473ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
