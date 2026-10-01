import { useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";

// Chrome (Android and desktop) fires this once its own installability
// criteria are met (manifest + service worker + a bit of engagement) - but
// then shows nothing on its own unless the site calls .preventDefault() and
// holds onto the event to trigger later. That's what this does: instead of
// leaving it to Chrome's own unpredictable timing/heuristics for its mini
// infobar, we capture the event once and let the app show its own "Install"
// button whenever it wants, calling .prompt() on tap.
//
// iOS Safari never fires this event at all - there is no install API on
// iOS, by Apple's own design, for any website. So on iOS `canInstall` just
// stays false forever, which is exactly the right behavior there (nothing
// to show, since nothing can be triggered).
let deferredEvent: any = null;
const listeners = new Set<() => void>();

if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: any) => {
    e.preventDefault();
    deferredEvent = e;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferredEvent = null;
    listeners.forEach((l) => l());
  });
}

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(() => deferredEvent !== null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onChange = () => setCanInstall(deferredEvent !== null);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredEvent) return false;
    deferredEvent.prompt();
    const { outcome } = await deferredEvent.userChoice;
    deferredEvent = null;
    setCanInstall(false);
    return outcome === "accepted";
  }, []);

  return { canInstall, promptInstall };
}
