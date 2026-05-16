import {
  getAudioSettings,
  micSettingsForSource,
  type AudioSettings,
} from "@/lib/audioSettings";

let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;

export async function startMicEnhancer(
  sourceIsJapanese = false,
): Promise<void> {
  stopMicEnhancer();

  if (!navigator.mediaDevices?.getUserMedia) return;

  const base = getAudioSettings();
  const settings = micSettingsForSource(base, sourceIsJapanese);

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: settings.micEchoCancellation,
        noiseSuppression: settings.micNoiseSuppression,
        autoGainControl: settings.micAutoGain,
      },
    });

    if (settings.micNoiseFilter <= 0 && settings.micEnvironmentReduction <= 0) {
      return;
    }

    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(mediaStream);

    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value =
      70 + (settings.micNoiseFilter / 100) * 280;
    highpass.Q.value = 0.8 + (settings.micNoiseFilter / 100) * 1.2;

    const lowShelf = audioContext.createBiquadFilter();
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = 220 + (settings.micEnvironmentReduction / 100) * 180;
    lowShelf.gain.value = -(settings.micEnvironmentReduction / 100) * 14;

    const silent = audioContext.createGain();
    silent.gain.value = 0;

    source.connect(highpass);
    highpass.connect(lowShelf);
    lowShelf.connect(silent);
    silent.connect(audioContext.destination);

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
  } catch {
    stopMicEnhancer();
  }
}

export function stopMicEnhancer(): void {
  mediaStream?.getTracks().forEach((t) => t.stop());
  mediaStream = null;

  if (audioContext) {
    void audioContext.close();
    audioContext = null;
  }
}

export function isMicEnhancerActive(): boolean {
  return mediaStream !== null;
}
