# Technical Design — Realtime Việt ↔ Nhật (Web)

Bổ sung cho [PRD.md](./PRD.md). **MVP triển khai:** client-only, API miễn phí, không lưu audio server.

## Quyết định đã chốt

| Hạng mục | Lựa chọn |
|----------|----------|
| Mic | Tap bật/tắt (continuous recognition khi ON) |
| Output | TTS ưu tiên; text đích phụ |
| API | Web Speech + Chrome Translator / MyMemory + speechSynthesis |
| Privacy | Không upload audio; MyMemory chỉ nhận **text** |

---

## 1. Module map (client)

```
src/
  app/
    page.tsx                 # Shell: 1 button UI
  features/
    speak/
      SpeakButton.tsx        # hold-to-talk, haptic
      useSpeakSession.ts     # orchestrator
    audio/
      capture.ts             # getUserMedia, worklet
      vad.ts                 # energy / wasm silero
      chunker.ts             # 200–400ms frames
    pipeline/
      asrClient.ts           # Web Speech | WSS
      mtClient.ts              # debounced partial MT
      ttsQueue.ts              # cancel-previous policy
    battery/
      visibility.ts
      wakeLock.ts
      powerMode.ts           # normal | saver
```

---

## 2. State machine (session)

```
IDLE ──(pointerdown)──► LISTENING
LISTENING ──(speech detected)──► STREAMING
STREAMING ──(partial mt)──► SPEAKING (optional)
STREAMING ──(pointerup)──► FINALIZING
FINALIZING ──(final mt+tts)──► IDLE
ANY ──(visibility hidden)──► PAUSED → IDLE
```

---

## 3. WebSocket protocol (draft)

**Client → Server**

```json
{ "type": "start", "sourceLang": "ja", "targetLang": "vi", "mode": "deep" }
{ "type": "audio", "seq": 12, "codec": "opus", "data": "<base64>" }
{ "type": "stop" }
```

**Server → Client**

```json
{ "type": "asr_partial", "text": "駅は", "stability": 0.72, "lang": "ja" }
{ "type": "asr_final", "text": "駅はどこですか" }
{ "type": "mt_partial", "text": "Nhà ga", "stable": true }
{ "type": "mt_final", "text": "Nhà ga ở đâu?" }
{ "type": "tts", "url": "blob:...", "mime": "audio/mpeg" }
```

---

## 4. Deep listen parameters

| Lang | `silenceMs` | `ringBufferSec` | `minPartialChars` |
|------|-------------|-----------------|-------------------|
| `ja` | 850 | 2.5 | 2 (mora-aware) |
| `vi` | 550 | 2.0 | 3 |

Server ASR nên bật `interim_results` + `utterance_end_ms` tương ứng.

---

## 5. Fast MT policy

1. Chỉ gọi MT khi `partial` có stable prefix (ASR stability ≥ 0,6 **hoặc** 300 ms không đổi text).
2. Debounce 200 ms (normal) / 400 ms (saver).
3. `mt_final` luôn chạy sau `asr_final`; client so sánh và chỉ TTS lại nếu khác.

---

## 6. TTS queue

```ts
class TtsQueue {
  private utteranceId = 0;
  speak(text: string, lang: string) {
    const id = ++this.utteranceId;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.onend = () => { if (id !== this.utteranceId) return; /* done */ };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  cancel() {
    this.utteranceId++;
    speechSynthesis.cancel();
  }
}
```

Cloud TTS: dùng `AudioBufferSourceNode` + `stop()` khi có chunk mới.

---

## 7. Battery hooks

```ts
document.addEventListener('visibilitychange', () => {
  if (document.hidden) session.pause(); // stop tracks, close WS
});

// Chỉ khi đang hold nút
await navigator.wakeLock?.request('screen');
```

**Saver mode:** tắt waveform canvas, ẩn source text, chunk 500 ms, không gửi audio khi VAD &lt; threshold 5 frame liên tiếp.

---

## 8. API routes (Next.js)

| Route | Method | Role |
|-------|--------|------|
| `/api/session` | POST | Tạo token, trả WSS URL |
| `/api/ws` | WS | Proxy ASR/MT/TTS hoặc logic edge |
| `/api/health` | GET | Probe |

Secrets: `GOOGLE_APPLICATION_CREDENTIALS`, `DEEPGRAM_API_KEY`, v.v. — **không** expose client.

---

## 9. Browser matrix

| Platform | ASR | MT | TTS | Background mic |
|----------|-----|----|----|------------------|
| Chrome Android | Web Speech + cloud fallback | Cloud | Cloud / synth | Hạn chế, pause khi hidden khuyến nghị |
| Safari iOS | Cloud only | Cloud | Cloud / synth | Không đáng tin — pause |
| Chrome desktop | Web Speech | Hybrid | Synth | N/A |

---

## 10. Metrics (client telemetry)

- `asr_first_partial_ms`
- `mt_first_partial_ms`
- `tts_start_ms`
- `session_duration_sec`
- `battery_drop_per_hour` (optional, user opt-in)

Gửi batch tới analytics (Plausible / self-hosted) — không gửi raw audio.
