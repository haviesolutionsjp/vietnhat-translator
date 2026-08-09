"use client";

import { useCallback, useEffect, useState } from "react";
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
    let active = true;
    void detectHeadphonesConnected().then((connected) => {
      if (!active) return;
      setHeadphonesConnected(connected);
      setReady(true);
    });

    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;

    const onDeviceChange = () => {
      void detectHeadphonesConnected().then((connected) => {
        if (!active) return;
        setHeadphonesConnected(connected);
      });
    };

    media.addEventListener("devicechange", onDeviceChange);
    return () => {
      active = false;
      media.removeEventListener("devicechange", onDeviceChange);
    };
  }, []);

  return { headphonesConnected, ready, refresh };
}
