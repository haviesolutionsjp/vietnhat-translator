"use client";

import { useCallback } from "react";
import {
  DEFAULT_AUDIO_SETTINGS,
  type AudioSettings,
} from "@/lib/audioSettings";
import { speechPlaybackHint } from "@/lib/speechPlayback";
import { SpeechPlaybackPicker } from "@/components/SpeechPlaybackPicker";

type Props = {
  open: boolean;
  settings: AudioSettings;
  headphonesConnected: boolean;
  onClose: () => void;
  onChange: (settings: AudioSettings) => void;
};

export function SettingsPanel({
  open,
  settings,
  headphonesConnected,
  onClose,
  onChange,
}: Props) {
  const patch = useCallback(
    (partial: Partial<AudioSettings>) => {
      onChange({ ...settings, ...partial });
    },
    [onChange, settings],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-zinc-800 bg-[#12161e] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="settings-title" className="text-lg font-semibold text-zinc-100">
            Cài đặt âm thanh
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Đóng
          </button>
        </div>

        <section className="mb-6 space-y-3">
          <h3 className="text-sm font-medium text-zinc-300">Tai nghe & phát âm</h3>
          <SpeechPlaybackPicker
            mode={settings.playbackMode}
            headphonesConnected={headphonesConnected}
            onChange={(mode) => patch({ playbackMode: mode })}
          />
          <p className="text-xs text-zinc-600">
            {speechPlaybackHint(settings.playbackMode, headphonesConnected)}
          </p>
        </section>

        <section className="mb-6 space-y-4">
          <h3 className="text-sm font-medium text-zinc-300">Âm lượng đọc (bản dịch)</h3>
          <SliderField
            label="Âm lượng"
            value={settings.ttsVolume}
            min={30}
            max={100}
            unit="%"
            onChange={(ttsVolume) => patch({ ttsVolume })}
          />
          <SliderField
            label="Tốc độ đọc"
            value={settings.ttsSpeed}
            min={70}
            max={130}
            unit="%"
            onChange={(ttsSpeed) => patch({ ttsSpeed })}
          />
          <ToggleRow
            label="Tiếng Nhật rõ hơn"
            description="Chậm và rõ hơn khi đọc tiếng Nhật"
            checked={settings.japaneseClarity}
            onChange={(japaneseClarity) => patch({ japaneseClarity })}
          />
        </section>

        <section className="mb-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-300">
            Micro — lọc tiếng ồn
          </h3>
          <p className="text-xs text-zinc-500">
            Giúp nghe tiếng Nhật / tiếng Việt rõ hơn khi có ồn xung quanh. Áp dụng
            khi bật nút Nói.
          </p>
          <ToggleRow
            label="Khử ồn môi trường"
            description="Giảm tiếng ồn nền qua micro"
            checked={settings.noiseSuppression}
            onChange={(noiseSuppression) => patch({ noiseSuppression })}
          />
          <ToggleRow
            label="Loại tiếng vọng"
            checked={settings.echoCancellation}
            onChange={(echoCancellation) => patch({ echoCancellation })}
          />
          <ToggleRow
            label="Tự chỉnh âm lượng micro"
            checked={settings.autoGainControl}
            onChange={(autoGainControl) => patch({ autoGainControl })}
          />
          <ToggleRow
            label="Lọc âm trầm & ồn nền"
            description="Cắt tiếng ồn tần thấp, nén âm thanh"
            checked={settings.ambientNoiseFilter}
            onChange={(ambientNoiseFilter) => patch({ ambientNoiseFilter })}
          />
          {settings.ambientNoiseFilter ? (
            <SliderField
              label="Mức lọc tiếng ồn"
              value={settings.noiseFilterStrength}
              min={0}
              max={100}
              unit="%"
              onChange={(noiseFilterStrength) => patch({ noiseFilterStrength })}
            />
          ) : null}
        </section>

        <button
          type="button"
          className="w-full rounded-xl border border-zinc-700 py-2.5 text-sm text-zinc-400 hover:bg-zinc-800"
          onClick={() => onChange({ ...DEFAULT_AUDIO_SETTINGS })}
        >
          Khôi phục mặc định
        </button>
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-zinc-400">{label}</span>
        <span className="tabular-nums text-zinc-200">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-sky-500"
      />
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-3">
      <span>
        <span className="block text-sm text-zinc-200">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-zinc-500">{description}</span>
        ) : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-sky-500"
      />
    </label>
  );
}
