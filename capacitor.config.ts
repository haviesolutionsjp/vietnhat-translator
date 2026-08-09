import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.vietnhat.translator",
  appName: "Việt - Nhật Translator",
  webDir: "out",
  ios: {
    contentInset: "always",
    preferredContentMode: "mobile",
    allowsLinkPreview: false,
    scrollEnabled: true,
  },
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
};

export default config;
