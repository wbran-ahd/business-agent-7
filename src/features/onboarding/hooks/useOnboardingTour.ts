/**
 * First-run tour state: the 60-second onboarding.
 *
 * The step, the "finished/skipped" record and the telemetry events are
 * unchanged; the hook only owns them so the page can compose. Opening a shop or
 * the settings panel from a tour step is delegated to the caller.
 */
import { useCallback, useEffect, useState } from "react";
import type { ShopTab } from "@/features/shop";
import {
  finishOnboarding,
  loadOnboarding,
  persistOnboarding,
  secondsSpent,
  shouldShowOnboarding,
  skipOnboarding,
  startOnboarding,
  type OnboardingStep,
} from "@/lib/onboarding";
import { track } from "@/lib/telemetry";

/** First-run state: load, and start the tour when it is due. */
function initialTourState() {
  const loaded = loadOnboarding();
  if (!shouldShowOnboarding(loaded)) return loaded;
  const started = startOnboarding(loaded);
  persistOnboarding(started);
  return started;
}

export type UseOnboardingTourOptions = {
  openShop: (tab: ShopTab) => void;
  openSettings: () => void;
};

export function useOnboardingTour({ openShop, openSettings }: UseOnboardingTourOptions) {
  const [onboarding, setOnboarding] = useState(initialTourState);
  const [onboardingOpen, setOnboardingOpen] = useState(() =>
    shouldShowOnboarding(onboarding),
  );

  useEffect(() => {
    if (onboardingOpen) track("onboarding_start");
  }, [onboardingOpen]);

  const setOnboardingStep = useCallback((step: number) => {
    setOnboarding((current) => {
      const next = { ...current, step };
      persistOnboarding(next);
      return next;
    });
  }, []);

  const handleTourFinish = useCallback(() => {
    setOnboarding((current) => {
      const next = finishOnboarding(current);
      persistOnboarding(next);
      track("onboarding_done", { seconds: secondsSpent(next) });
      return next;
    });
    setOnboardingOpen(false);
  }, []);

  const handleTourSkip = useCallback(() => {
    setOnboarding((current) => {
      const next = skipOnboarding(current);
      persistOnboarding(next);
      track("onboarding_skip", { step: current.step });
      return next;
    });
    setOnboardingOpen(false);
  }, []);

  const handleTourAction = useCallback(
    (step: OnboardingStep) => {
      setOnboardingOpen(false);
      if (step.id === "shop") openShop("customers");
      else if (step.id === "backup") openSettings();
      track("onboarding_action", { step: step.id });
    },
    [openSettings, openShop],
  );

  return {
    onboarding,
    onboardingOpen,
    setOnboardingStep,
    handleTourFinish,
    handleTourSkip,
    handleTourAction,
  };
}
