"use client";

import {
  speechPlaybackHint,
  SPEECH_PLAYBACK_OPTIONS,
  type SpeechPlaybackMode,
} from "@/lib/speechPlayback";

type Props = {
  mode: SpeechPlaybackMode;
  headphonesConnected: boolean;
  onChange: (mode: SpeechPlaybackMode) => void;
};

export function SpeechPlaybackPicker({
  mode,
  headphonesConnected,
  onChange,
}: Props) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2">
      <p className="text-xs text-zinc-500">Phát âm ngôn ngữ đích</p>
      <div
        className="grid w-full grid-cols-3 gap-1 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-1"
        role="group"
        aria-label="Chế độ phát âm"
      >
        {SPEECH_PLAYBACK_OPTIONS.map(({ mode: option, label, short }) => {
          const selected = mode === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              aria-label={label}
              onClick={() => onChange(option)}
              className={`min-h-11 cursor-pointer touch-manipulation rounded-xl px-2 py-2 text-center transition select-none active:scale-[0.98] ${
                selected
                  ? option === "headphones"
                    ? "bg-sky-700 text-white shadow-sm"
                    : option === "on"
                      ? "bg-emerald-800 text-white shadow-sm"
                      : "bg-zinc-700 text-white shadow-sm"
                  : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
              }`}
            >
              <span className="pointer-events-none block text-xs font-semibold">
                {short}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-center text-xs text-zinc-500">
        {speechPlaybackHint(mode, headphonesConnected)}
      </p>
    </div>
  );
}
