import { useEffect, useState } from "react";

// Installing the app on a phone or computer. Chrome and Edge offer a real
// install prompt (the `beforeinstallprompt` event, which must be caught early,
// so this file is imported from main.tsx). Safari on iPhone and iPad has no
// prompt: the only way is Share → Add to Home Screen, so we show those steps.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

/** True when the app is running from the home screen / as an installed app. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  return {
    installed: isInstalled(),
    ios: isIos(),
    /** A real one-tap install is available (Chrome, Edge, Android). */
    canPrompt: deferred !== null,
    async install(): Promise<"accepted" | "dismissed" | "unavailable"> {
      if (!deferred) return "unavailable";
      const d = deferred;
      deferred = null;
      await d.prompt();
      const { outcome } = await d.userChoice;
      notify();
      return outcome;
    },
  };
}
