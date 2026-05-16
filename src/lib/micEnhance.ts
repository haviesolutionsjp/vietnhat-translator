import type { AudioSettings } from "@/lib/audioSettings";

export type MicSession = {
  cleanup: () => void;
};

/**
 * Giữ micro với constraint khử ồn — giúp Chrome áp dụng xử lý trước nhận dạng giọng.
 * Lọc âm trầm bổ sung qua Web Audio khi bật ambientNoiseFilter.
 */
export async function startMicSession(
  settings: AudioSettings,
): Promise<MicSession> {
  const strength = settings.noiseFilterStrength / 100;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 16000 },
    },
  });

  let audioContext: AudioContext | null = null;

  if (settings.ambientNoiseFilter && typeof AudioContext !== "undefined") {
    try {
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const highpass = audioContext.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 80 + strength * 180;
      highpass.Q.value = 0.7;

      const lowShelf = audioContext.createBiquadFilter();
      lowShelf.type = "lowshelf";
      lowShelf.frequency.value = 200;
      lowShelf.gain.value = -3 - strength * 6;

      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -22 - strength * 12;
      compressor.knee.value = 12;
      compressor.ratio.value = 3 + strength * 4;
      compressor.attack.value = 0.01;
      compressor.release.value = 0.15;

      const sink = audioContext.createAnalyser();
      source.connect(highpass);
      highpass.connect(lowShelf);
      lowShelf.connect(compressor);
      compressor.connect(sink);

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
    } catch {
      audioContext?.close();
      audioContext = null;
    }
  }

  return {
    cleanup: () => {
      stream.getTracks().forEach((t) => t.stop());
      if (audioContext) {
        void audioContext.close();
      }
    },
  };
}
