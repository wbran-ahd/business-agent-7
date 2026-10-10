/**
 * Accessible modal.
 *
 * The hand-rolled `<div className="modal">` blocks were missing every basic
 * affordance: no Escape key, no focus trap, no ARIA roles and no scroll lock.
 * This keeps the exact same visual classes (`.modal`, `.glass-panel`) so the
 * rendered pixels do not move, while adding the behaviour screen readers and
 * keyboard users expect.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  label,
  children,
  scrollable = false,
  fontSans = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
  /** Adds `overflow-y-auto` to the panel. */
  scrollable?: boolean;
  /** The notepad panel keeps Nastaliq; settings/analytics opt into sans. */
  fontSans?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`glass-panel w-full max-w-lg m-4 p-6 outline-none ${
          scrollable ? "max-h-[90vh] overflow-y-auto" : "max-h-[85vh]"
        } flex flex-col relative${fontSans ? " font-sans" : ""}`}
      >
        <span id={titleId} className="sr-only">
          {label}
        </span>
        {children}
      </div>
    </div>
  );
}

/** Shared header row: title on the left (RTL), close button on the right. */
export function ModalHeader({
  icon,
  iconClass,
  children,
  onClose,
}: {
  icon: string;
  iconClass: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
      <h2 className="text-lg font-bold text-white flex items-center gap-2">
        <i className={`fas ${icon} ${iconClass}`}></i> {children}
      </h2>
      <button
        onClick={onClose}
        aria-label="بند کریں"
        className="text-white/50 hover:text-white transition"
      >
        <i className="fas fa-times text-xl"></i>
      </button>
    </div>
  );
}
