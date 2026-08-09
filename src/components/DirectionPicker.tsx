"use client";

import { directionLabel, type Direction } from "@/lib/lang";

type Props = {
  activeDirection: Direction | null;
  listening?: boolean;
};

export function DirectionPicker({ activeDirection, listening }: Props) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-1.5">
      <div className="relative flex w-full items-center justify-between overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/60 px-4 py-2.5 backdrop-blur-md shadow-inner">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                listening
                  ? "animate-ping bg-red-400"
                  : activeDirection
                    ? "animate-pulse bg-emerald-400"
                    : "bg-teal-400"
              }`}
            />
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                listening
                  ? "bg-red-500"
                  : activeDirection
                    ? "bg-emerald-500"
                    : "bg-teal-500"
              }`}
            />
          </span>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <span>Tự động nhận diện:</span>
              {activeDirection ? (
                <span
                  className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                    activeDirection === "vi-ja"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  }`}
                >
                  {directionLabel(activeDirection)}
                </span>
              ) : (
                <span className="text-zinc-400 font-normal">
                  Việt ⇄ Nhật
                </span>
              )}
            </div>
            <span className="text-[11px] text-zinc-400 truncate">
              {activeDirection
                ? activeDirection === "vi-ja"
                  ? "Nói tiếng Việt → Bản dịch & phát âm tiếng Nhật"
                  : "Nói tiếng Nhật → Bản dịch & phát âm tiếng Việt"
                : "Tự động phát hiện tiếng Việt hoặc tiếng Nhật khi bạn nói"}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium rounded-lg px-2.5 py-1 transition-all border shadow-sm">
          {listening ? (
            <span className="flex items-center gap-1 text-red-400 bg-red-950/40 border-red-800/40">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-ping" />
              Micro luôn bật
            </span>
          ) : (
            <span className="text-emerald-400 bg-emerald-950/50 border-emerald-800/40">
              Auto 2 chiều
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
