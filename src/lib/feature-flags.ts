/**
 * Feature-flag helpers — pure questions, no side effects.
 *
 * `shouldShow` and `shouldLoad` intentionally read the same matrix: a panel
 * must never be rendered from data that was not allowed to load, and a load
 * must never run for something that will not be shown. Keeping them as two
 * named functions makes the call site say which question it is asking, which
 * matters when sync decides what to fetch.
 *
 * ⚠️ Nothing calls these yet. Wiring them into a screen or into sync is a
 * behaviour change and needs approval (phase 3).
 */

import { getFeatures, type ModeFeature, type SegmentMode } from "@/lib/mode";

/** Should this screen/element be visible for the given mode? */
export function shouldShow(feature: ModeFeature, mode: SegmentMode): boolean {
  return getFeatures(mode)[feature] === true;
}

/** Should this data be fetched/synced for the given mode? */
export function shouldLoad(feature: ModeFeature, mode: SegmentMode): boolean {
  return getFeatures(mode)[feature] === true;
}
