"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DirectionPicker } from "@/components/DirectionPicker";
import { SettingsSheet } from "@/components/SettingsSheet";
import { TargetSpeech } from "@/components/TargetSpeech";
import { useAudioOutput } from "@/hooks/useAudioOutput";
import {
  detectDirection,
  directionLabel,
  listenHint,
  resolveDirection,
  sourceLang,
  targetLangName,
  type Direction,
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
import { shouldAutoPlaySpeech } from "@/lib/speechPlayback";
import { cancelSpeech, prepareVoices, speakForDirection } from "@/lib/tts";

type Status = "idle" | "listening" | "translating" | "speaking";

const INTERIM_STABLE_MS = 100;
const INTERIM_RETRANSLATE_GAP_MS = 120;
const INTERIM_MIN_CHARS = 2;
const AUTO_SEGMENT_SPEAK_MS = 3_500;
const AUTO_SEGMENT_MIN_CHARS = 2;

const emptySubscribe = () => () => {};

function useIsMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

function minCharsFor(direction: Direction): number {
  return direction === "ja-vi" ? 1 : INTERIM_MIN_CHARS;
}

export function TranslatorApp() {
  const mounted = useIsMounted();
  const [detectedDirection, setDetectedDirection] = useState<Direction | null>(null);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [lastTranslation, setLastTranslation] = useState("");
  const [lastTranslateLatencyMs, setLastTranslateLatencyMs] = useState<number | null>(null);
  const [lastSpeakDirection, setLastSpeakDirection] = useState<Direction>("vi-ja");
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => {
    if (typeof window !== "undefined") {
      return loadAudioSettings();
    }
    return DEFAULT_AUDIO_SETTINGS;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [textInputOpen, setTextInputOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof window !== "undefined" ? isSpeechRecognitionSupported() : true;

  const {
    headphonesConnected,
    ready: audioOutputReady,
    refresh: refreshAudioOutput,
  } = useAudioOutput();

  const listeningRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
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
  const lastInterimTranslateAtRef = useRef(0);
  const latestTranscriptRef = useRef("");
  const lastAutoSpokenSourceRef = useRef("");
  const autoSpeakTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    detectedRef.current = detectedDirection;
  }, [detectedDirection]);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    audioSettingsRef.current = audioSettings;
  }, [audioSettings]);

  useEffect(() => {
    headphonesRef.current = headphonesConnected;
  }, [headphonesConnected]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    lastInterimTranslateAtRef.current = 0;
    latestTranscriptRef.current = "";
    lastAutoSpokenSourceRef.current = "";
    setListening(false);
    setStatus("idle");
    networkRetriesRef.current = 0;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    if (autoSpeakTimerRef.current) clearInterval(autoSpeakTimerRef.current);
    autoSpeakTimerRef.current = null;
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
  }, []);

  const scheduleRestartRef = useRef<(delayMs: number) => void>(() => {});

  const scheduleRecognitionRestart = useCallback((delayMs: number) => {
    scheduleRestartRef.current(delayMs);
  }, []);

  useEffect(() => {
    scheduleRestartRef.current = (delayMs: number) => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = setTimeout(() => {
        if (!listeningRef.current || !recognitionRef.current) return;
        try {
          recognitionRef.current.start();
        } catch {
          scheduleRestartRef.current(Math.min(delayMs * 2, 3000));
        }
      }, delayMs);
    };
  }, []);

  const maybeSwitchAutoLang = useCallback(
    (text: string) => {
      const resolved = resolveDirection("auto", text);
      if (detectedRef.current === resolved) return;

      setDetectedDirection(resolved);
      detectedRef.current = resolved;

      const recognition = recognitionRef.current;
      if (recognition && listeningRef.current) {
        const lang = sourceLang(resolved);
        try {
          recognition.lang = lang;
          recognition.stop();
        } catch {
          /* ignore */
        }
        scheduleRecognitionRestart(200);
      }
    },
    [scheduleRecognitionRestart],
  );

  const playTranslation = useCallback(
    (
      translated: string,
      direction: Direction,
      opts?: { force?: boolean; final?: boolean },
    ) => {
      if (
        !opts?.force &&
        !shouldAutoPlaySpeech(
          audioSettingsRef.current.playbackMode,
          headphonesRef.current,
        )
      ) {
        return;
      }

      const sameAsLast = translated === lastSpokenTranslationRef.current;
      if (sameAsLast && !opts?.final) return;

      lastSpokenTranslationRef.current = translated;
      setStatus("speaking");

      void speakForDirection(translated, direction).then((ok) => {
        if (!ok && listeningRef.current) {
          setStatus("listening");
        } else if (!listeningRef.current) {
          setStatus("idle");
        }
      });
    },
    [],
  );

  const runTranslation = useCallback(
    async (
      sourceText: string,
      opts?: { final?: boolean; forceSpeak?: boolean },
    ) => {
      const trimmed = sourceText.trim();
      const direction = resolveDirection("auto", trimmed);
      if (trimmed.length < minCharsFor(direction)) {
        return;
      }

      setDetectedDirection(direction);

      const dedupeKey = `${direction}:${trimmed}`;
      if (
        !opts?.final &&
        dedupeKey === `${lastTranslatedDirRef.current}:${lastTranslatedRef.current}`
      ) {
        return;
      }

      const gen = ++translateGenRef.current;
      const startedAt = performance.now();
      setStatus("translating");
      setError(null);

      try {
        const translated = await translateText(trimmed, direction);
        if (gen !== translateGenRef.current || !translated) return;

        lastTranslatedRef.current = trimmed;
        lastTranslatedDirRef.current = direction;
        setLastTranslateLatencyMs(Math.max(1, Math.round(performance.now() - startedAt)));
        setLastSpeakDirection(direction);
        setLastTranslation(translated);

        const willAutoSpeak =
          Boolean(opts?.forceSpeak) ||
          shouldAutoPlaySpeech(
            audioSettingsRef.current.playbackMode,
            headphonesRef.current,
          );

        playTranslation(translated, direction, {
          force: Boolean(opts?.forceSpeak),
          final: Boolean(opts?.final),
        });

        if (listeningRef.current && !willAutoSpeak) {
          setStatus("listening");
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
      setTranscript(text);
      maybeSwitchAutoLang(text);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (isFinal) {
        void runTranslation(text, { final: true });
        stableTextRef.current = "";
        return;
      }

      const now = Date.now();
      const trimmed = text.trim();
      latestTranscriptRef.current = trimmed;
      if (trimmed !== stableTextRef.current) {
        stableTextRef.current = trimmed;
        stableSinceRef.current = now;
      }

      const minChars = minCharsFor(resolveDirection("auto", trimmed));
      if (
        trimmed.length >= minChars &&
        now - lastInterimTranslateAtRef.current >= INTERIM_RETRANSLATE_GAP_MS
      ) {
        lastInterimTranslateAtRef.current = now;
        void runTranslation(trimmed);
      }

      debounceRef.current = setTimeout(() => {
        const stableFor = Date.now() - stableSinceRef.current;
        const stable = stableTextRef.current.trim();
        const stableMinChars = minCharsFor(resolveDirection("auto", stable));
        if (
          stableFor >= INTERIM_STABLE_MS &&
          stable.length >= stableMinChars &&
          Date.now() - lastInterimTranslateAtRef.current >= INTERIM_RETRANSLATE_GAP_MS
        ) {
          lastInterimTranslateAtRef.current = Date.now();
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
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) finalText += text;
          else interim += text;
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
              "Cần cấp quyền micro trong cài đặt trình duyệt để dùng giọng nói.",
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
      setError("Trình duyệt chưa hỗ trợ nhận dạng giọng nói trực tiếp. Bạn có thể gõ văn bản để dịch.");
      return;
    }

    if (!isSecureMicContext()) {
      setError(
        "Micro yêu cầu kết nối an toàn (HTTPS hoặc localhost).",
      );
      return;
    }

    try {
      networkRetriesRef.current = 0;
      setDetectedDirection(null);
      detectedRef.current = null;

      const initialDir: Direction = lastSpeakDirection || "vi-ja";
      const recognition = createRecognition(initialDir);
      recognition.lang = sourceLang(initialDir);
      recognitionRef.current = recognition;
      bindRecognitionHandlers(recognition);

      recognition.start();
      void refreshAudioOutput();
      setListening(true);
      listeningRef.current = true;
      setStatus("listening");
      setError(null);
      setLastTranslateLatencyMs(null);
      lastTranslatedRef.current = "";
      lastTranslatedDirRef.current = null;
      lastSpokenTranslationRef.current = "";
      lastInterimTranslateAtRef.current = 0;
      latestTranscriptRef.current = "";
      lastAutoSpokenSourceRef.current = "";
      translateGenRef.current = 0;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không bật được micro");
      stopListening();
    }
  }, [bindRecognitionHandlers, lastSpeakDirection, refreshAudioOutput, stopListening]);

  const toggleListening = useCallback(() => {
    if (listening) {
      stopListening();
      cancelSpeech();
      return;
    }
    prepareVoices();
    setTranscript("");
    setLastTranslation("");
    setLastTranslateLatencyMs(null);
    lastTranslatedRef.current = "";
    lastTranslatedDirRef.current = null;
    lastSpokenTranslationRef.current = "";
    lastInterimTranslateAtRef.current = 0;
    latestTranscriptRef.current = "";
    lastAutoSpokenSourceRef.current = "";
    startRecognition();
  }, [listening, startRecognition, stopListening]);

  const handleManualTranslate = useCallback(() => {
    const trimmed = manualText.trim();
    if (!trimmed) return;
    const direction = detectDirection(trimmed);
    setDetectedDirection(direction);
    setTranscript(trimmed);
    void runTranslation(trimmed, { final: true, forceSpeak: true });
  }, [manualText, runTranslation]);

  const copyToClipboard = useCallback(() => {
    if (!lastTranslation) return;
    navigator.clipboard.writeText(lastTranslation).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [lastTranslation]);

  useEffect(() => {
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
        void speakForDirection(text, dir).then((ok) => {
          if (listeningRef.current) {
            setStatus(ok ? "speaking" : "listening");
          } else {
            setStatus("idle");
          }
        });
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
    },
    [lastTranslation, playTranslation],
  );

  useEffect(() => {
    if (!listening) {
      if (autoSpeakTimerRef.current) clearInterval(autoSpeakTimerRef.current);
      autoSpeakTimerRef.current = null;
      return;
    }

    autoSpeakTimerRef.current = setInterval(() => {
      if (!listeningRef.current) return;
      const source = latestTranscriptRef.current.trim();
      if (source.length < AUTO_SEGMENT_MIN_CHARS) return;
      if (source === lastAutoSpokenSourceRef.current) return;

      lastAutoSpokenSourceRef.current = source;
      void runTranslation(source, { final: true, forceSpeak: true });
    }, AUTO_SEGMENT_SPEAK_MS);

    return () => {
      if (autoSpeakTimerRef.current) clearInterval(autoSpeakTimerRef.current);
      autoSpeakTimerRef.current = null;
    };
  }, [listening, runTranslation]);

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

  const activeDirection = detectedDirection;

  const statusLabel =
    status === "listening"
      ? detectedDirection
        ? `${listenHint(detectedDirection)}…`
        : "Đang nghe (tự nhận tiếng Việt hoặc Nhật)…"
      : status === "translating"
        ? "Đang dịch…"
        : status === "speaking"
          ? "Đang đọc bản dịch…"
          : listening
            ? "Đang nghe…"
            : "Chạm nút micro để bắt đầu nói";

  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-between bg-[#0c0f14] text-zinc-100 px-4 py-4 sm:px-6 sm:py-6 selection:bg-emerald-500/30">
      {/* Header */}
      <header className="relative z-20 flex w-full max-w-lg shrink-0 flex-col items-center gap-3">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-sm font-bold text-black shadow-md shadow-emerald-500/20">
              VN
            </span>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-zinc-100 sm:text-lg">
                Việt ↔ Nhật
              </h1>
              <p className="text-[11px] text-zinc-400">Dịch giọng nói thời gian thực</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTextInputOpen(!textInputOpen)}
              className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition active:scale-95 ${
                textInputOpen
                  ? "border-emerald-500 bg-emerald-950/60 text-emerald-300"
                  : "border-zinc-800 bg-zinc-900/80 text-zinc-300 hover:border-zinc-700 hover:text-white"
              }`}
              aria-label="Nhập văn bản"
            >
              <KeyboardIcon />
              <span className="hidden sm:inline">Nhập chữ</span>
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white active:scale-95"
              aria-label="Cài đặt âm thanh"
            >
              <GearIcon />
              <span className="hidden sm:inline">Cài đặt</span>
            </button>
          </div>
        </div>

        <DirectionPicker
          activeDirection={activeDirection}
          listening={listening}
        />
      </header>

      {/* Settings Modal */}
      <SettingsSheet
        open={settingsOpen}
        settings={audioSettings}
        headphonesConnected={headphonesConnected}
        onChange={handleSettingsChange}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Main Translation Arena */}
      <main className="relative z-0 flex min-h-0 w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 py-4">
        {/* Status Indicator */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full transition-all duration-300 ${
                status === "listening"
                  ? "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)] animate-ping"
                  : status === "translating"
                    ? "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.8)] animate-pulse"
                    : status === "speaking"
                      ? "bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.8)] animate-pulse"
                      : "bg-zinc-600"
              }`}
            />
            <p className="text-center text-sm font-medium text-zinc-300" aria-live="polite">
              {statusLabel}
            </p>
          </div>

          {lastTranslateLatencyMs !== null && (
            <p className="text-[11px] text-zinc-500">
              Độ trễ dịch: <span className="text-zinc-400 font-mono">{lastTranslateLatencyMs}ms</span>
            </p>
          )}
        </div>

        {/* Text Input Panel (Optional Dropdown/Collapsible) */}
        {textInputOpen && (
          <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/90 p-3.5 shadow-xl backdrop-blur-md transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-zinc-400">
                {manualText.trim()
                  ? `Tự động nhận diện: ${directionLabel(detectDirection(manualText))}`
                  : "Tự động nhận diện: Tiếng Việt ⇄ Tiếng Nhật"}
              </span>
              <button
                type="button"
                onClick={() => setTextInputOpen(false)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Đóng
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleManualTranslate();
                }}
                placeholder="Nhập tiếng Việt hoặc tiếng Nhật..."
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50"
              />
              <button
                type="button"
                onClick={handleManualTranslate}
                className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 active:scale-95 shadow-md shadow-emerald-950"
              >
                Dịch
              </button>
            </div>
          </div>
        )}

        {/* Live Transcript / Recognized Source Box */}
        {transcript && (
          <div className="w-full rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Lời nói nhận dạng ({targetLangName(lastSpeakDirection === "vi-ja" ? "ja-vi" : "vi-ja")})
              </span>
              {listening && (
                <span className="flex items-center gap-1 text-[11px] text-red-400 animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Live
                </span>
              )}
            </div>
            <p className="text-base leading-relaxed text-zinc-200">{transcript}</p>
          </div>
        )}

        {/* Big Interactive Mic Action Button */}
        <div className="relative flex items-center justify-center my-2">
          {/* Animated Glow Rings when Listening */}
          {listening && (
            <>
              <div className="absolute h-48 w-48 rounded-full bg-red-500/10 animate-ping" />
              <div className="absolute h-44 w-44 rounded-full bg-red-500/15 animate-pulse" />
            </>
          )}

          <button
            type="button"
            onClick={toggleListening}
            aria-pressed={listening}
            aria-label={listening ? "Tắt nghe" : "Bật micro để dịch giọng nói"}
            className={`group relative flex h-36 w-36 sm:h-40 sm:w-40 flex-col items-center justify-center rounded-full text-xl font-bold shadow-2xl transition-all duration-300 active:scale-90 ${
              listening
                ? "bg-gradient-to-tr from-red-600 to-rose-500 text-white shadow-red-900/60 ring-4 ring-red-500/40"
                : "bg-gradient-to-tr from-emerald-600 via-emerald-500 to-teal-400 text-white shadow-emerald-950/80 hover:scale-105 hover:shadow-emerald-500/30"
            }`}
          >
            {listening ? (
              <div className="flex flex-col items-center gap-2">
                <MicActiveIcon />
                <span className="text-sm font-semibold tracking-wide uppercase">Dừng</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <MicIcon />
                <span className="text-base font-semibold tracking-wide">Nói & Dịch</span>
              </div>
            )}
          </button>
        </div>

        {/* Translation Output Card */}
        {lastTranslation ? (
          <div className="w-full rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-950/20 to-zinc-900/60 p-5 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Bản dịch ({targetLangName(lastSpeakDirection)})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className="flex items-center gap-1 rounded-lg border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-zinc-700 hover:text-white"
                  aria-label="Sao chép bản dịch"
                >
                  <CopyIcon />
                  {copied ? "Đã chép" : "Chép"}
                </button>
              </div>
            </div>

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
          </div>
        ) : (
          <div className="flex flex-col items-center text-center max-w-xs text-xs text-zinc-500 gap-1.5">
            <p>
              {audioSettings.playbackMode === "off"
                ? "Chế độ phát âm đang tắt. Bản dịch sẽ hiển thị bằng văn bản."
                : audioSettings.playbackMode === "headphones" && !headphonesConnected
                  ? "Cắm tai nghe để tự động phát âm giọng nói."
                  : "Chạm nút micro và nói câu tiếng Việt hoặc tiếng Nhật."}
            </p>
          </div>
        )}
      </main>

      {/* Footer / Error feedback */}
      <footer className="relative z-10 flex w-full max-w-lg flex-col items-center gap-2 pt-2">
        {error && (
          <div className="flex w-full items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-950/40 p-3 text-xs text-amber-300" role="alert">
            <AlertIcon />
            <p className="flex-1">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-amber-400 hover:text-amber-200"
            >
              ✕
            </button>
          </div>
        )}

        {mounted && !supported && (
          <p className="text-center text-xs text-zinc-500">
            Mẹo: Để dịch bằng giọng nói, hãy mở trên Google Chrome, Edge hoặc Safari.
          </p>
        )}
      </footer>
    </div>
  );
}

function MicIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-9 w-9">
      <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" />
      <path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z" />
    </svg>
  );
}

function MicActiveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-9 w-9 animate-pulse">
      <path fillRule="evenodd" d="M4.5 7.5a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9Z" clipRule="evenodd" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M2 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5Zm3.25 2a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5h-1.5ZM8.5 7a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-1.5 0v-.01A.75.75 0 0 1 8.5 7Zm2.75.75a.75.75 0 0 0 1.5 0v-.01a.75.75 0 0 0-1.5 0v.01ZM14.75 7a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-1.5 0v-.01a.75.75 0 0 1 .75-.75ZM5.25 10.5a.75.75 0 0 0 0 1.5h.01a.75.75 0 0 0 0-1.5h-.01Zm2.5.75a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.5.12.98.29 1.435.507l1.36-.977a1 1 0 0 1 1.25.125l.962.962a1 1 0 0 1 .125 1.25l-.977 1.36c.217.455.387.935.507 1.435l1.473.295A1 1 0 0 1 19 10.68v1.36a1 1 0 0 1-.804.98l-1.473.295a6.77 6.77 0 0 1-.507 1.435l.977 1.36a1 1 0 0 1-.125 1.25l-.962.962a1 1 0 0 1-1.25.125l-1.36-.977c-.455.217-.935.387-1.435.507l-.295 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.77 6.77 0 0 1-1.435-.507l-1.36.977a1 1 0 0 1-1.25-.125l-.962-.962a1 1 0 0 1-.125-1.25l.977-1.36a6.77 6.77 0 0 1-.507-1.435L1.804 11.66A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.12-.5.29-.98.507-1.435l-.977-1.36a1 1 0 0 1 .125-1.25l.962-.962a1 1 0 0 1 1.25-.125l1.36.977c.455-.217.935-.387 1.435-.507l.295-1.473ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12a1.5 1.5 0 0 1 .439 1.061V14.5A1.5 1.5 0 0 1 15.5 16h-7A1.5 1.5 0 0 1 7 14.5v-11Z" />
      <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-1h-1.5v1a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h1V6h-1Z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-amber-400">
      <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
    </svg>
  );
}
