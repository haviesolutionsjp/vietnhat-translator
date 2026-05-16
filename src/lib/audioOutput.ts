const HEADPHONE_PATTERN =
  /headphone|headset|earbud|earphone|airpod|bluetooth|usb audio|external|wired|耳机|耳機|イヤホン|ヘッドホン/i;

/** Phát hiện tai nghe / loa ngoài qua danh sách thiết bị âm thanh */
export async function detectHeadphonesConnected(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return false;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");

    if (outputs.length === 0) return false;

    const withLabel = outputs.filter((d) => d.label.length > 0);
    if (withLabel.some((d) => HEADPHONE_PATTERN.test(d.label))) {
      return true;
    }

    // Nhiều đầu ra âm thanh thường có tai nghe / bluetooth
    if (outputs.length > 1) return true;

    return false;
  } catch {
    return false;
  }
}
