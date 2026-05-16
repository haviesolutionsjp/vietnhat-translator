"use client";

import { SpeechPlaybackPicker } from "@/components/SpeechPlaybackPicker";
import type { AudioSettings } from "@/lib/audioSettings";
import type { SpeechPlaybackMode } from "@/lib/speechPlayback";

type Props = {
  open: boolean;
  settings: AudioSettings;
  headphonesConnected: boolean;
  onChange: (settings: AudioSettings) => void;
  onClose: () => void;
};

export function SettingsSheet({
  open,
  settings,
  headphonesConnected,
  onChange,
  onClose,
}: Props) {
  if (!open) return null;

  const patch = (partial: Partial<AudioSettings>) => {
    onChange({ ...settings, ...partial });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Đóng cài đặt"
        onClick={onClose}
      />
      <section
        className="relative max-h-[88dvh] overflow-y-auto rounded-t-3xl border border-zinc-800 bg-[#12161e] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-zinc-600" />
        <header className="mb-5 flex items-center justify-between">
          <h2 id="settings-title" className="text-lg font-semibold text-zinc-100">
            Cài đặt âm thanh
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Xong
          </button>
        </header>

        <div className="flex flex-col gap-6">
          <section>
            <h3 className="mb-3 text-sm font-medium text-zinc-300">
              Tai nghe &amp; phát âm bản dịch
            </h3>
            <SpeechPlaybackPicker
              mode={settings.playbackMode}
              headphonesConnected={headphonesConnected}
              onChange={(mode: SpeechPlaybackMode) =>
                patch({ playbackMode: mode })
              }
            />
          </section>

          <section>
            <h3 className="mb-3 text-sm font-medium text-zinc-300">
              Âm lượng bản dịch
            </h3>
            <Slider
              label="Âm lượng"
              value={Math.round(settings.ttsVolume * 100)}
              min={20}
              max={100}
              unit="%"
              onChange={(v) => patch({ ttsVolume: v / 100 })}
            />
            <Toggle
              label="Nghe tiếng Nhật rõ hơn"
              description="Giọng đọc chậm và sáng hơn khi phát tiếng Nhật"
              checked={settings.jaClarityBoost}
              onChange={(jaClarityBoost) => patch({ jaClarityBoost })}
            />
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium text-zinc-300">
              Micro — lọc ồn khi nghe
            </h3>
            <p className="mb-3 text-xs text-zinc-500">
              Giúp nhận dạng tiếng Nhật tốt hơn trong môi trường ồn. Bật mạnh hơn
              khi bạn nói tiếng Nhật.
            </p>
            <Slider
              label="Lọc tiếng ồn"
              value={settings.micNoiseFilter}
              min={0}
              max={100}
              onChange={(micNoiseFilter) => patch({ micNoiseFilter })}
            />
            <Slider
              label="Giảm ồn môi trường"
              value={settings.micEnvironmentReduction}
              min={0}
              max={100}
              onChange={(micEnvironmentReduction) =>
                patch({ micEnvironmentReduction })
              }
            />
            <div className="mt-2 flex flex-col gap-2">
              <Toggle
                label="Khử ồn micro"
                checked={settings.micNoiseSuppression}
                onChange={(micNoiseSuppression) =>
                  patch({ micNoiseSuppression })
                }
              />
              <Toggle
                label="Khử vang"
                checked={settings.micEchoCancellation}
                onChange={(micEchoCancellation) =>
                  patch({ micEchoCancellation })
                }
              />
              <Toggle
                label="Tự chỉnh âm lượng micro"
                checked={settings.micAutoGain}
                onChange={(micAutoGain) => patch({ micAutoGain })}
              />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mb-3 block">
      <div className="mb-1.5 flex justify-between text-sm text-zinc-400">
        <span>{label}</span>
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

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-2.5">
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
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded accent-sky-500"
      />
    </label>
  );
}
