"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectHeadphonesConnected } from "@/lib/audioOutput";

export function useAudioOutput() {
  const [headphonesConnected, setHeadphonesConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    const connected = await detectHeadphonesConnected();
    setHeadphonesConnected(connected);
    setReady(true);
    return connected;
  }, []);

  useEffect(() => {
    void refresh();

    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;

    const onDeviceChange = () => {
      void refresh();
    };

    media.addEventListener("devicechange", onDeviceChange);
    return () => media.removeEventListener("devicechange", onDeviceChange);
  }, [refresh]);

  return { headphonesConnected, ready, refresh };
}
