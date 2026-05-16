"use client";

import {
  DIRECTION_OPTIONS,
  directionLabel,
  type Direction,
  type DirectionMode,
} from "@/lib/lang";

type Props = {
  mode: DirectionMode;
  activeDirection: Direction | null;
  onChange: (mode: DirectionMode) => void;
};

export function DirectionPicker({
  mode,
  activeDirection,
  onChange,
}: Props) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2">
      <div
        className="relative z-10 grid w-full grid-cols-3 gap-1 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-1"
        role="group"
        aria-label="Chiều dịch"
      >
        {DIRECTION_OPTIONS.map(({ mode: option, label, short }) => {
          const selected = mode === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              aria-label={label}
              onClick={() => {
                if (option !== mode) onChange(option);
              }}
              className={`min-h-11 cursor-pointer touch-manipulation rounded-xl px-2 py-2.5 text-center transition select-none active:scale-[0.98] ${
                selected
                  ? option === "vi-ja"
                    ? "bg-emerald-700 text-white shadow-sm"
                    : option === "ja-vi"
                      ? "bg-rose-700 text-white shadow-sm"
                      : "bg-violet-700 text-white shadow-sm"
                  : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
              }`}
            >
              <span className="pointer-events-none block text-xs font-semibold sm:text-sm">
                {short}
              </span>
              <span className="pointer-events-none mt-0.5 hidden text-[10px] opacity-80 sm:block">
                {label}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-center text-xs text-zinc-500">
        {mode === "auto" ? (
          activeDirection ? (
            <>
              Phát hiện:{" "}
              <span className="text-zinc-300">
                {directionLabel(activeDirection)}
              </span>
            </>
          ) : (
            "Tự nhận tiếng Việt hoặc Nhật khi bạn nói"
          )
        ) : (
          <>
            Nghe{" "}
            <span className="text-zinc-300">
              {mode === "vi-ja" ? "tiếng Việt" : "tiếng Nhật"}
            </span>
            , đọc{" "}
            <span className="text-zinc-300">
              {mode === "vi-ja" ? "tiếng Nhật" : "tiếng Việt"}
            </span>
          </>
        )}
      </p>
    </div>
  );
}
