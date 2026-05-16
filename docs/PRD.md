# PRD — Ứng dụng dịch thuật thời gian thực Việt ↔ Nhật (Web)

**Phiên bản:** 0.1  
**Ngày:** 2026-05-16  
**Trạng thái:** Draft — nghiên cứu & định hướng kỹ thuật

---

## 1. Tóm tắt

Ứng dụng web chạy trên trình duyệt điện thoại, cho phép hai người (hoặc một người) nói tiếng Việt hoặc tiếng Nhật và nghe bản dịch **gần thời gian thực** sang ngôn ngữ còn lại. Giao diện tối giản: **một nút “Nói”**, không nhập văn bản. Ưu tiên:

1. **Lắng nghe sâu ngôn ngữ nguồn** — nhận diện chính xác, đủ ngữ cảnh, ít cắt câu sai.
2. **Phát bản dịch ngôn ngữ đích nhanh** — giảm độ trễ cảm nhận (perceived latency).
3. **Tiết kiệm pin** khi dùng lâu, kể cả khi tab ở nền (trong giới hạn nền tảng).

---

## 2. Bối cảnh & vấn đề

| Vấn đề hiện tại | Hướng giải quyết |
|-----------------|------------------|
| App dịch đa tính năng (gõ text, camera, flashcard) gây rối | Chỉ luồng **voice-in → voice/text-out** |
| Dịch “đợi hết câu” → chậm | Pipeline **streaming**: partial ASR → partial MT → TTS sớm |
| ASR cắt sớm (đặc biệt tiếng Nhật) | **Deep listen**: buffer dài hơn, VAD theo ngôn ngữ, giữ partial hypotheses |
| Chạy nền trên mobile web tốn pin / bị suspend | VAD, tắt mic khi im lặng, Wake Lock có kiểm soát, PWA + visibility hooks |
| Safari iOS hạn chế Web Speech API | Chiến lược **hybrid**: client khi được, cloud STT khi bắt buộc |

---

## 3. Mục tiêu sản phẩm

### 3.1 Mục tiêu chính (Must have)

- Dịch **ja → vi** và **vi → ja** bằng micro, realtime.
- UI: màn hình chính chỉ có **nút “Nói”** (hold-to-talk hoặc tap toggle — quyết định ở mục 7).
- Hiển thị tối thiểu: câu nguồn (tùy chọn) + câu đích; có thể **chỉ phát âm** đích để giảm tải UI/pin.
- Hoạt động tốt trên **Chrome Android** (ưu tiên); có lộ trình cho Safari iOS qua backend.

### 3.2 Mục tiêu chất lượng

| Chỉ số | Mục tiêu (MVP) | Mục tiêu (v1) |
|--------|----------------|---------------|
| Độ trễ end-to-end (nói → nghe bản dịch) | &lt; 2,5 s (câu ngắn) | &lt; 1,5 s |
| WER/độ chính xác ASR (câu hội thoại) | Không đo formal MVP; QA thủ công | &gt; 90% câu hiểu đúng ý |
| Thời gian dùng liên tục (pin) | ≥ 45 phút (mid-range Android, 50% brightness) | ≥ 90 phút với chế độ tiết kiệm |
| Crash / mic drop | &lt; 1% phiên 10 phút | &lt; 0,1% |

### 3.3 Out of scope (v0)

- Nhập văn bản, OCR camera, flashcard, lịch sử phức tạp.
- Dịch offline hoàn toàn (có thể lộ trình v2 với model on-device qua WASM — nặng, không MVP).

---

## 4. Persona & use case

**Persona A — Du học sinh / lao động tại Nhật:** Nói tiếng Việt với đồng nghiệp Nhật, cần nghe lại tiếng Nhật nhanh.

**Persona B — Khách du lịch:** Nghe người Nhật nói, cần tiếng Việt ngay (hoặc ngược lại).

**Use case cốt lõi**

1. Mở web → cấp quyền micro (một lần, ghi nhớ trong session).
2. Chọn chiều dịch (auto / Việt→Nhật / Nhật→Việt) — có thể **một toggle nhỏ**, không phải ô nhập text.
3. Giữ/nhấn **Nói** → nói → nghe/đọc bản dịch.
4. Tab chuyển nền: tiếp tục phiên nếu nền tảng cho phép; nếu không — thông báo rõ và tạm dừng mic.

---

## 5. Yêu cầu chức năng

### FR-01 — Thu âm & nhận dạng (ASR) ngôn ngữ nguồn

- Thu stream audio từ `getUserMedia` (mono, 16 kHz hoặc 48 kHz downsample phía client).
- Hỗ trợ **streaming partial results** (không chỉ final).
- **Deep listen (ngôn ngữ nguồn):**
  - **Endpointing chậm hơn** với tiếng Nhật (khoảng lặng ~700–900 ms vs ~500 ms với tiếng Việt) — cấu hình theo `sourceLang`.
  - Giữ **ring buffer** 2–3 giây trước khi commit câu để không mất âm đầu từ.
  - Gửi **audio + partial transcript** lên server (nếu dùng cloud) để model disambiguate (ví dụ 橋/箸).
  - **Language ID** khi chế độ Auto: confidence &gt; 0,85 mới đổi chiều dịch; tránh flip ja/vi giữa câu.

### FR-02 — Dịch máy (MT) sang ngôn ngữ đích

- Input: partial/final text + `sourceLang`, `targetLang`.
- **Fast target output:**
  - Dịch trên **cụm đã ổn định** (stable prefix của partial ASR), không đợi full stop.
  - **Debounce MT** 150–250 ms để tránh gọi API quá dày.
  - Cache cụm thường gặp (xin chào, cảm ơn, すみません…) — memory + `sessionStorage`.
  - Chính sách hiển thị: chỉ cập nhật UI khi bản dịch **thay đổi đáng kể** (hash hoặc Levenshtein &gt; ngưỡng).

### FR-03 — Phát âm (TTS) ngôn ngữ đích

- Queue TTS: hủy utterance cũ nếu có bản dịch mới hơn (tránh đọc chồng).
- Ưu tiên giọng **vi-VN**, **ja-JP** native; fallback browser `speechSynthesis`.
- Tùy chọn **chỉ TTS, ẩn text** (tiết kiệm render + pin).

### FR-04 — Giao diện “chỉ nút Nói”

- Loại bỏ: ô input, bàn phím, paste, lịch sử dài, grid tính năng.
- Cho phép tối đa:
  - Nút **Nói** (primary, ≥ 72×72 dp).
  - Indicator trạng thái: Idle / Listening / Translating / Speaking.
  - Toggle nhỏ: chiều dịch (vi↔ja / auto).
  - (Tùy chọn v1) nút **Loa** bật/tắt TTS.

### FR-05 — Phiên & quyền

- Lần đầu: giải thích quyền micro ngắn gọn (tiếng Việt).
- Mất quyền / mic bận: banner + nút thử lại.
- Không lưu audio lên server quá thời gian xử lý (nếu cloud: xóa buffer sau MT, tuân thủ privacy).

### FR-06 — Chạy nền (background)

- Khi `document.hidden`:
  - **Dừng mic** nếu không có `Wake Lock` + user bật “Dịch khi màn hình tắt” (tùy chọn, mặc định tắt để tiết pin).
  - Trên Android Chrome: có thể dùng **Media Session API** + silent audio hack (hạn chế, document rủi ro store policy).
- Khi quay lại foreground: khôi phục phiên trong &lt; 1 s.

> **Ràng buộc nền tảng (bắt buộc ghi trong UX):** iOS Safari **không** duy trì nhận dạng giọng nói liên tục khi tab background lâu; MVP ưu tiên Android Chrome, iOS cần backend streaming và kỳ vọng “tạm dừng khi ẩn tab”.

---

## 6. Yêu cầu phi chức năng

### NFR-01 — Hiệu năng & độ trễ

Pipeline mục tiêu (song song):

```
[Mic] → VAD → Chunk 200–400ms → ASR partial ─┬→ MT partial → UI/TTS
                                              └→ (deep buffer) ASR final → MT polish
```

- **Perceived latency:** phát TTS cụm đầu tiên đủ tin cậy (confidence ASR &gt; 0,75).
- **Final polish:** khi ASR final, MT có thể sửa lại 1 lần; TTS chỉ đọc lại nếu khác &gt; 20% ký tự.

### NFR-02 — Pin & tài nguyên

| Kỹ thuật | Mục đích |
|----------|----------|
| VAD client-side (energy threshold / Silero nhẹ WASM) | Không gửi/network khi im lặng |
| `AudioWorklet` + buffer cố định | Tránh main thread + GC spike |
| Giảm tần suất partial UI (max 5 fps text) | Giảm layout/paint |
| `navigator.wakeLock` chỉ khi đang giữ “Nói” | Tránh CPU wake liên tục |
| `visibilitychange` → pause pipeline | Tab ẩn = mic off mặc định |
| Opus/WebM chunk 32–64 kbps nếu stream cloud | Giảm bandwidth & radio |
| Không animation nền, dark theme OLED-friendly | Giảm pin màn hình |

### NFR-03 — Bảo mật & quyền riêng tư

- HTTPS bắt buộc; micro chỉ trên secure context.
- API key server-side; client chỉ có session token ngắn hạn.
- Không ghi âm persistent mặc định; opt-in mới lưu lịch sử cục bộ.

### NFR-04 — Khả dụng & i18n UI

- UI app: tiếng Việt (chính), nhãn phụ tiếng Nhật cho Persona B.
- Font hỗ trợ Kanji + dấu tiếng Việt.

---

## 7. Thiết kế UX (wireframe logic)

```
┌─────────────────────────────┐
│  Việt ↔ Nhật    [Auto ▾]    │  ← optional, 1 dòng
│                             │
│     (subtle waveform)       │  ← chỉ khi Listening
│                             │
│         ┌─────────┐         │
│         │  NÓI    │         │  ← hold hoặc tap
│         └─────────┘         │
│                             │
│  「こんにちは」              │  ← optional, fade partial
│  Xin chào                   │  ← đích, cập nhật streaming
└─────────────────────────────┘
```

**Hành vi nút Nói (đề xuất MVP):** **Hold-to-talk** — giảm false trigger, dễ hiểu, pin tốt hơn “always listening”.

**Không có:** keyboard, textarea, search, tab điều hướng dưới.

---

## 8. Kiến trúc kỹ thuật đề xuất

### 8.1 Tổng quan

```
┌─────────────── Client (PWA) ───────────────┐
│  UI (1 button)                             │
│  Audio capture + VAD + chunker             │
│  Optional: Web Speech API (Chrome)         │
│  WebSocket client (streaming)              │
└──────────────────┬─────────────────────────┘
                   │ WSS
┌──────────────────▼─────────────────────────┐
│  API Gateway / Edge (Vercel, CF Workers)   │
│  Session auth, rate limit                    │
└──────────────────┬─────────────────────────┘
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
  ASR stream    MT stream     TTS stream
  (Deepgram /   (Google /     (Google /
   Azure /        DeepL /       Azure /
   OpenAI RT)     OpenAI)       ElevenLabs)
```

### 8.2 Lựa chọn công nghệ (đánh giá)

| Thành phần | Phương án A (MVP nhanh) | Phương án B (chất lượng ja/vi) | Ghi chú |
|------------|-------------------------|--------------------------------|---------|
| ASR | Web Speech API (Chrome) | Deepgram nova-2 / Azure Speech streaming | Web Speech **không** đủ cho Safari iOS |
| MT | Chrome Translator API (nếu có) | Google Cloud Translation v3 / DeepL | Cần benchmark cụm ngắn ja↔vi |
| TTS | `speechSynthesis` | Google/Azure neural TTS stream | Neural ja/vi tự nhiên hơn |
| Transport | WebSocket binary audio | Same | Gửi metadata: lang, partial_id |

**Khuyến nghị:** **Hybrid MVP** — Chrome Android dùng Web Speech cho ASR (0 cost, ít pin network) + server MT/TTS; iOS và chất lượng Nhật cao → full cloud streaming ASR.

### 8.3 “Deep listen” vs “Fast target” — cấu hình

```ts
// Pseudocode — endpointing & pipeline
const config = {
  ja: { silenceMs: 850, minSpeechMs: 400, ringBufferSec: 2.5 },
  vi: { silenceMs: 550, minSpeechMs: 300, ringBufferSec: 2.0 },
};

onPartialAsr(text, stability) {
  if (stability > 0.6) scheduleMt(text, { debounceMs: 200 });
}
onFinalAsr(text) {
  flushMt(text, { polish: true });
  maybeReplayTtsIfDiff();
}
```

### 8.4 Stack đề xuất (khớp repo hiện có)

- **Frontend:** Next.js 16 (App Router), PWA manifest, Service Worker **chỉ cache static** (không cache audio).
- **Backend:** Route Handlers + WebSocket (hoặc tách worker Node/Deno).
- **Deploy:** Vercel / Fly.io (WebSocket sticky).

---

## 9. Luồng dữ liệu chi tiết

### 9.1 Happy path (cloud streaming)

1. User hold **Nói** → `getUserMedia` + optional `wakeLock.request('screen')`.
2. VAD phát hiện speech → gửi chunk Opus qua WSS.
3. Server ASR trả `partial` / `final` + word confidence.
4. Server MT trả `translation_partial` khi stable prefix đủ dài.
5. Client hiển thị & enqueue TTS; user thả nút → `final` ASR → polish MT → TTS lần cuối.
6. Thả nút → release wake lock, flush queue.

### 9.2 Auto-detect chiều dịch

- 3 giây đầu phiên: LID từ ASR model.
- Cố định chiều cho đến khi user đổi toggle hoặc confidence LID &lt; 0,5 trong 2 câu liên tiếp.

---

## 10. Tối ưu pin — checklist triển khai

- [ ] Mic **chỉ** bật khi hold nút (hoặc khi VAD bật trong session active).
- [ ] Tab `hidden` → `stopTracks()` trong 500 ms.
- [ ] Không `setInterval` &lt; 100 ms; dùng `requestAnimationFrame` có gate.
- [ ] Debounce React state (partial text).
- [ ] Prefetch voice TTS một lần / session.
- [ ] Quality toggle: **Tiết kiệm pin** (chunk 500 ms, MT debounce 400 ms, không hiện text nguồn).
- [ ] Đo thực tế: Chrome DevTools → Performance + `navigator.getBattery()` sampling (Android).

---

## 11. Rủi ro & giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|------------|
| iOS không ASR nền | Cao | Cloud ASR + messaging rõ; TestFlight wrapper sau |
| Chi phí API streaming | Trung bình | Giới hạn phút/ngày; hybrid Web Speech |
| Độ trễ mạng 3G | Trung bình | Edge gần VN/JP; chunk nhỏ; UI “đang dịch” |
| TTS chồng nhau | Thấp | Cancel `speechSynthesis` / abort audio node |
| Store/policy background audio | Trung bình | Không auto-play silent track trừ khi user opt-in |

---

## 12. Lộ trình

### Phase 0 — Spike (1 tuần)

- Benchmark ASR ja/vi: Web Speech vs Deepgram trên câu mẫu 50 câu.
- Đo latency E2E và pin 15 phút trên 1 máy Android.

### Phase 1 — MVP (2–3 tuần)

- UI 1 nút + hold-to-talk.
- Chiều cố định vi↔ja (chưa auto).
- Cloud: ASR + MT + TTS streaming.
- PWA install prompt.

### Phase 2 — v1 (2 tuần)

- Auto LID, deep listen config theo ngôn ngữ.
- Chế độ tiết kiệm pin.
- Partial UI polish, cache cụm.

### Phase 3 — (tùy chọn)

- Conversation mode 2 người (2 nút hoặc auto speaker diarization).
- Offline pack giới hạn.

---

## 13. Tiêu chí chấp nhận (MVP)

- [ ] Không có ô nhập văn bản trên màn hình chính.
- [ ] Hold **Nói** → nói tiếng Việt → nghe/đọc tiếng Nhật trong &lt; 2,5 s (mạng 4G, Tokyo/HCM edge).
- [ ] Hold **Nói** → nói tiếng Nhật → nghe/đọc tiếng Việt tương tự.
- [ ] Tab background 30 s trên Android: mic tắt, không crash; foreground resume OK.
- [ ] Session 30 phút: pin giảm &lt; 25% so với baseline video playback (thiết bị reference TBD).

---

## 14. Phụ lục — So sánh với prototype hiện có

| Repo | Trạng thái | Ghi chú |
|------|------------|---------|
| `vietnhat-translator` (Next.js) | Skeleton | Cần thay `page.tsx` bằng UI 1 nút + pipeline |
| `nihongo_translate` (Flutter) | UI mock đa tính năng | Không khớp hướng web-only, tham khảo wireframe cũ để **loại bỏ** |

---

## 15. Quyết định product (đã chốt — 2026-05-16)

| # | Quyết định | Hệ quả kỹ thuật |
|---|------------|------------------|
| 1 | **Bật/tắt (tap)** để nghe ngôn ngữ nguồn | `SpeechRecognition` continuous khi ON; tắt mic + recognition khi OFF hoặc tab ẩn |
| 2 | **Ưu tiên nghe bản dịch** | TTS tự phát ngay; text đích phụ (có thể ẩn); không hiển thị text nguồn mặc định |
| 3 | **API miễn phí** | Stack **100% client**: Web Speech API + Chrome Translator API (nếu có) → MyMemory (fallback) + `speechSynthesis` |
| 4 | **Không lưu audio trên server** | Không backend upload; không WebSocket audio; mọi xử lý trên thiết bị / API text-only |

### Stack miễn phí (MVP)

```
Mic → Web Speech API (ASR, trên máy/trình duyệt)
    → Text → Translator API (Chrome) | MyMemory GET (text)
    → speechSynthesis (TTS đích)
```

- **MyMemory:** ~1.000 từ/ngày/IP (miễn phí); có thể thêm email trong query để tăng quota.
- **Không có server riêng** lưu audio; không cần API key trả phí cho MVP.

---

*Tài liệu này là cơ sở cho thiết kế kỹ thuật (Technical Design Doc) và backlog sprint tiếp theo.*
