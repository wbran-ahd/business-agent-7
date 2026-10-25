import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_MODE,
  getFeatures,
  readUserMode,
  type ModeFeature,
  type ModeFeatures,
  type SegmentMode,
} from "@/lib/mode";

export type UseModeResult = {
  mode: SegmentMode;
  features: Readonly<ModeFeatures>;
  hasFeature: (feature: ModeFeature) => boolean;
};

/**
 * Exposes the segment mode to a screen.
 *
 * ⚠️ No screen uses this yet, on purpose: switching a panel on or off is a UI
 * change, and the UI is frozen. This hook exists so phase 3+ can opt in one
 * component at a time, with approval, instead of rewriting the data layer.
 *
 * The default render is always `both`, i.e. exactly today's behaviour.
 */
export function useMode(userId: string | null | undefined): UseModeResult {
  /**
   * The user whose mode we actually read, stored together with the value.
   * Deriving from the pair means a signed-out or switched user never shows the
   * previous user's mode, and no `setMode` is needed in the effect body.
   */
  const [resolved, setResolved] = useState<{ userId: string | null; mode: SegmentMode }>({
    userId: null,
    mode: DEFAULT_MODE,
  });

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    void readUserMode(userId).then((next) => {
      if (!cancelled) setResolved({ userId, mode: next });
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const mode = userId && resolved.userId === userId ? resolved.mode : DEFAULT_MODE;
  const features = useMemo(() => getFeatures(mode), [mode]);

  const hasFeature = useCallback((feature: ModeFeature) => features[feature] === true, [features]);

  return { mode, features, hasFeature };
}
