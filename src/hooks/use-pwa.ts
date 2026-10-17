/**
 * PWA plumbing: service-worker registration, install prompt, offline state and
 * “new version ready”. The UI stays honest — nothing is shown until the browser
 * actually offers an install prompt or reports that it lost the network.
 */
import { logError } from "@/lib/logger";
import { useCallback, useEffect, useRef, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export type UsePwa = {
  online: boolean;
  installable: boolean;
  installed: boolean;
  updateReady: boolean;
  registered: boolean;
  install: () => Promise<boolean>;
  applyUpdate: () => void;
};

export function usePwa(): UsePwa {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState(isStandalone);
  const [updateReady, setUpdateReady] = useState(false);
  const [registered, setRegistered] = useState(false);

  const promptRef = useRef<InstallPromptEvent | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (cancelled) return;
        registrationRef.current = registration;
        setRegistered(true);

        if (registration.waiting && navigator.serviceWorker.controller) {
          setUpdateReady(true);
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });
      } catch (error) {
        // A failed SW registration must never break the ledger.
        logError("pwa", "service worker registration failed", error);
      }
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as InstallPromptEvent;
      setInstallable(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallable(false);
      promptRef.current = null;
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const prompt = promptRef.current;
    if (!prompt) return false;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      promptRef.current = null;
      setInstallable(false);
      return choice.outcome === "accepted";
    } catch (error) {
      logError("pwa", "install prompt failed", error);
      return false;
    }
  }, []);

  const applyUpdate = useCallback(() => {
    const waiting = registrationRef.current?.waiting;
    if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
    // Reload regardless: without a waiting worker the cache version already
    // changed, so a fresh document is what the user needs.
    window.location.reload();
  }, []);

  return { online, installable, installed, updateReady, registered, install, applyUpdate };
}
