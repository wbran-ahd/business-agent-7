/**
 * 60-second onboarding.
 *
 * Same glass tokens as the rest of the app (`glass-panel`, white/5 surfaces,
 * sky accents) — no new palette, no layout shift on the dashboard because it is
 * a modal that only opens on first run.
 */
import { Modal } from "@/components/sauti/Modal";
import {
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL_SECONDS,
  stepLabel,
  type OnboardingStep,
} from "@/lib/onboarding";
import { BRAND } from "@/lib/brand";

const smallBtn =
  "px-3 py-2 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1.5";

export function Onboarding({
  open,
  step,
  onStep,
  onFinish,
  onSkip,
  onAction,
}: {
  open: boolean;
  step: number;
  onStep: (index: number) => void;
  onFinish: () => void;
  onSkip: () => void;
  onAction?: (step: OnboardingStep) => void;
}) {
  const index = Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, step));
  const current = ONBOARDING_STEPS[index]!;
  const last = index === ONBOARDING_STEPS.length - 1;

  return (
    <Modal open={open} onClose={onSkip} label="صوتی بقیہ کا تعارف" scrollable fontSans>
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl border border-sky-400/40 bg-sky-500/15 text-sky-300">
            <i className="fas fa-wand-magic-sparkles"></i>
          </span>
          <div className="leading-tight">
            <p className="nastaliq text-sm text-white">{BRAND.name}</p>
            <p className="text-[10px] text-white/45">{BRAND.tagline}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSkip}
          aria-label="تعارف چھوڑیں"
          className="text-white/45 transition hover:text-white"
        >
          <i className="fas fa-times text-lg"></i>
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between text-[11px] text-white/45">
        <span>{stepLabel(index)}</span>
        <span>
          <i className="fas fa-stopwatch ml-1 text-sky-300"></i>
          کل {ONBOARDING_TOTAL_SECONDS} سیکنڈ
        </span>
      </div>

      <div className="mt-2 flex gap-1.5" aria-hidden="true">
        {ONBOARDING_STEPS.map((item, itemIndex) => (
          <span
            key={item.id}
            className={`h-1.5 flex-1 rounded-full transition ${
              itemIndex <= index ? "bg-sky-400/80" : "bg-white/10"
            }`}
          />
        ))}
      </div>

      <div className="mt-5 flex items-start gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-xl text-sky-300">
          <i className={`fas ${current.icon}`}></i>
        </span>
        <div className="min-w-0">
          <h3 className="nastaliq text-lg leading-loose text-white">{current.title}</h3>
          <p className="mt-1 text-xs leading-6 text-white/70">{current.body}</p>
          {current.action && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-200">
              <i className="fas fa-lightbulb"></i> {current.action}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between text-[10px] text-white/40">
        <span>
          <i className="fas fa-clock ml-1"></i>
          اس مرحلے کے لیے تقریباً {current.seconds} سیکنڈ
        </span>
        {onAction && (
          <button
            type="button"
            onClick={() => onAction(current)}
            className="text-sky-300 underline decoration-dotted underline-offset-4 transition hover:text-sky-200"
          >
            ابھی آزمائیں
          </button>
        )}
      </div>

      <div className="mt-5 flex gap-2 border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={onSkip}
          className={`${smallBtn} flex-1 border-white/15 bg-white/5 text-white/60 hover:bg-white/10`}
        >
          چھوڑ دیں
        </button>
        {index > 0 && (
          <button
            type="button"
            onClick={() => onStep(index - 1)}
            className={`${smallBtn} flex-1 border-white/20 bg-white/10 text-white hover:bg-white/20`}
          >
            <i className="fas fa-arrow-right"></i> واپس
          </button>
        )}
        <button
          type="button"
          onClick={() => (last ? onFinish() : onStep(index + 1))}
          className={`${smallBtn} flex-[1.4] border-sky-500/40 bg-sky-500/25 text-sky-100 hover:bg-sky-500/35`}
        >
          {last ? (
            <>
              <i className="fas fa-check"></i> شروع کریں
            </>
          ) : (
            <>
              آگے <i className="fas fa-arrow-left"></i>
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}
