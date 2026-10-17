/**
 * 60-second Urdu onboarding.
 *
 * Four steps, each with a time budget that adds up to a minute. The copy is
 * deliberately about *one action per step* — a shopkeeper on a slow phone
 * should be able to finish before the first customer arrives.
 *
 * The state machine is plain data so the test suite can drive it without React.
 */

export type OnboardingStep = {
  id: string;
  title: string;
  body: string;
  /** Font Awesome class, matching the icon language used across the app. */
  icon: string;
  /** Short label for the “try it” affordance. */
  action?: string;
  seconds: number;
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "voice",
    title: "مائیک دبائیں اور بول دیں",
    body:
      "سبز مائیک دبائیں اور عام زبان میں بولیں: «دو سو روپے چائے»۔ رقم اور قسم خود پہچان لی جائے گی — نہ لکھنا، نہ حساب۔",
    icon: "fa-microphone-lines",
    action: "مثال: پانچ سو روپے پیٹرول",
    seconds: 12,
  },
  {
    id: "chips",
    title: "جلدی درج کریں",
    body:
      "مائیک کے نیچے 50 · 100 · 500 · 1000 کے بٹن ہیں۔ ایک دبائیں، آمدنی یا خرچہ چنیں، اور «درج» — بس۔",
    icon: "fa-bolt",
    action: "چپس آزمائیں",
    seconds: 12,
  },
  {
    id: "shop",
    title: "دکان کا کھاتہ",
    body:
      "گاہک اور سپلائر کا ادھار الگ کھاتے میں رہتا ہے۔ ہر گاہک کا بیلنس، واٹس ایپ پر یاد دہانی، اور دن کا حساب — ایک جگہ۔",
    icon: "fa-store",
    action: "دکان کھولیں",
    seconds: 18,
  },
  {
    id: "backup",
    title: "ڈیٹا محفوظ رکھیں",
    body:
      "ہفتے میں ایک بار CSV بیک اپ ڈاؤن لوڈ کریں یا کلاؤڈ پر اپ لوڈ کریں۔ فون بدلیں تو ڈیٹا واپس آ جائے گا؛ کوئی مشکل ہو تو واٹس ایپ پر مدد موجود ہے۔",
    icon: "fa-cloud-arrow-up",
    action: "بیک اپ کریں",
    seconds: 18,
  },
];

export const ONBOARDING_TOTAL_SECONDS = ONBOARDING_STEPS.reduce(
  (sum, step) => sum + step.seconds,
  0,
);

export const ONBOARDING_STORAGE = "sautiBaqayaOnboarding";

export type OnboardingState = {
  done: boolean;
  step: number;
  startedAt: number;
  finishedAt: number;
  /** Allows a future release to re-show the tour without wiping storage. */
  version: number;
};

export const ONBOARDING_VERSION = 1;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function defaultOnboarding(): OnboardingState {
  return { done: false, step: 0, startedAt: 0, finishedAt: 0, version: ONBOARDING_VERSION };
}

export function loadOnboarding(store: StorageLike | null = storage()): OnboardingState {
  if (!store) return defaultOnboarding();
  try {
    const raw = store.getItem(ONBOARDING_STORAGE);
    if (!raw) return defaultOnboarding();
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      done: parsed.done === true,
      step: Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, Number(parsed.step) || 0)),
      startedAt: Number(parsed.startedAt) || 0,
      finishedAt: Number(parsed.finishedAt) || 0,
      version: Number(parsed.version) || ONBOARDING_VERSION,
    };
  } catch {
    return defaultOnboarding();
  }
}

export function persistOnboarding(
  state: OnboardingState,
  store: StorageLike | null = storage(),
): void {
  try {
    store?.setItem(ONBOARDING_STORAGE, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

/** First run, or a tour that was abandoned halfway but never finished. */
export function shouldShowOnboarding(state: OnboardingState): boolean {
  return state.done !== true;
}

export function startOnboarding(state: OnboardingState, now = Date.now()): OnboardingState {
  return { ...state, startedAt: state.startedAt || now, finishedAt: 0, done: false };
}

export function gotoStep(state: OnboardingState, step: number): OnboardingState {
  const clamped = Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, Math.round(step)));
  return { ...state, step: clamped };
}

export function finishOnboarding(state: OnboardingState, now = Date.now()): OnboardingState {
  return { ...state, done: true, finishedAt: now, step: ONBOARDING_STEPS.length - 1 };
}

export function skipOnboarding(state: OnboardingState, now = Date.now()): OnboardingState {
  return { ...state, done: true, finishedAt: now };
}

/** Seconds actually spent on the tour — used to check the “60 second” promise. */
export function secondsSpent(state: OnboardingState): number {
  if (!state.startedAt) return 0;
  const end = state.finishedAt || Date.now();
  return Math.max(0, Math.round((end - state.startedAt) / 1000));
}

export function stepLabel(index: number): string {
  return `${index + 1} / ${ONBOARDING_STEPS.length}`;
}
