"use client";

import type { AudioSettings } from "@/lib/audioSettings";
import { targetLangName, type Direction } from "@/lib/lang";
import { cancelSpeech, speakForDirection } from "@/lib/tts";

type Props = {
  text: string;
  direction: Direction;
  settings: AudioSettings;
  speaking: boolean;
  onSpeakingChange: (speaking: boolean) => void;
};

export function TargetSpeech({
  text,
  direction,
  settings,
  speaking,
  onSpeakingChange,
}: Props) {
  const langLabel = targetLangName(direction);

  const play = async () => {
    if (!text.trim()) return;
    onSpeakingChange(true);
    cancelSpeech();
    await speakForDirection(text, direction, settings);
    onSpeakingChange(false);
  };

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3">
      <p
        className="text-center text-lg leading-relaxed text-zinc-200"
        aria-live="polite"
      >
        {text}
      </p>
      <button
        type="button"
        onClick={() => void play()}
        disabled={speaking}
        aria-label={`Phát âm ${langLabel}`}
        className="flex min-h-11 items-center gap-2 rounded-full border border-zinc-600 bg-zinc-800/80 px-5 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-700/80 active:scale-[0.98] disabled:opacity-50 touch-manipulation"
      >
        <SpeakerIcon active={speaking} />
        {speaking ? "Đang phát…" : `Nghe ${langLabel}`}
      </button>
    </div>
  );
}

function SpeakerIcon({ active }: { active: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`h-5 w-5 shrink-0 ${active ? "animate-pulse text-sky-400" : "text-sky-300"}`}
      aria-hidden
    >
      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.241 1.518 1.905 2.66 1.905H6.44l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z" />
      <path d="M15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}
