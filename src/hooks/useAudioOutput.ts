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

    const detect = async () => {
      const connected = await detectHeadphonesConnected();
      if (!active) return;
      setHeadphonesConnected(connected);
      setReady(true);
    };

    void detect();

    const media = navigator.mediaDevices;
    if (!media?.addEventListener) {
      return () => {
        active = false;
      };
    }

    const onDeviceChange = () => {
      void detect();
    };

    media.addEventListener("devicechange", onDeviceChange);
    return () => {
      active = false;
      media.removeEventListener("devicechange", onDeviceChange);
    };
  }, []);

  return { headphonesConnected, ready, refresh };
}
