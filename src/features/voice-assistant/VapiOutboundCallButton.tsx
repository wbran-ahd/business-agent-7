import { useCallback, useState, type ReactNode } from "react";
import { logError } from "@/lib/logger";
import {
  VAPI_BASE,
  VAPI_KEY_CONFIGURED,
  normalizePhoneNumber,
  type VapiPlaceOutboundCallArgs,
} from "@/convex/vapi";

/**
 * Vapi outbound call button.
 *
 * This component is the client side of the Vapi integration. It is kept intentionally
 * simple: the real backend action is defined in `src/convex/vapi-backend.ts` and the
 * shared helpers live in `src/convex/vapi.ts`.
 *
 * Verification status right now
 * ------------------------------
 * - Backend contract: wired (`src/convex/vapi-backend.ts`).
 * - Shared helpers: wired (`src/convex/vapi.ts`).
 * - Client component: wired (this file), but not live-tested.
 * - Environment: this workspace has no Vapi key set, so no outbound call has been
 *   placed yet.
 *
 * Why the Convex mutation is not imported here yet
 * ------------------------------------------------
 * The generated Convex API types do not include `api.vapi.placeOutboundCall` in this
 * environment because the Convex local backend cannot be generated right now. Until
 * `convex dev --once` succeeds and the client API types are regenerated, the button
 * uses the documented direct-style REST path below instead of a Convex mutation hook.
 */

export type VapiOutboundCallButtonProps = {
  assistantId: string;
  phoneNumberId: string;
  customerNumber: string;
  children: (state: VapiOutboundCallState) => ReactNode;
  /** Optional replacement for the default loading text during the network call. */
  loadingLabel?: string;
  /** Optional replacement for the default success text after a call is created. */
  successLabel?: (callId: string) => string;
};

export type VapiOutboundCallState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly callId: string }
  | {
      readonly status: "error";
      readonly message: string;
    };

export function VapiOutboundCallButton({
  assistantId,
  phoneNumberId,
  customerNumber,
  children,
  loadingLabel,
  successLabel,
}: VapiOutboundCallButtonProps) {
  const [state, setState] = useState<VapiOutboundCallState>({ status: "idle" });

  const startCall = useCallback(() => {
    setState({ status: "loading" });

    const apiKey = typeof process !== "undefined" ? process.env.VAPI_API_KEY : undefined;
    if (!apiKey) {
      setState({
        status: "error",
        message:
          "Vapi is not configured yet. Add VAPI_API_KEY in Settings → Environment and reload.",
      });
      return;
    }

    const customer = normalizePhoneNumber(customerNumber);
    if (!customer) {
      setState({
        status: "error",
        message:
          "Phone number looks wrong. Use an international format like +923001234567.",
      });
      return;
    }

    fetch(`${VAPI_BASE}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: customer },
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.text().catch(() => "")).slice(0, 500);
          throw new Error(
            `Vapi call creation failed (${response.status}). ${body ? `Response: ${body}` : ""}`,
          );
        }
        const result = (await response.json()) as Record<string, unknown>;
        const callId = result.id;
        if (typeof callId !== "string" || callId.length === 0) {
          throw new Error(
            "Vapi returned a call response we could not read (no `id` field).",
          );
        }
        return { callId };
      })
      .then((result) => {
        setState({
          status: "success",
          callId: result.callId,
        });
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "Vapi call could not be started.";
        setState({ status: "error", message });
        logError("voice", "Vapi outbound call failed", error);
      });
  }, [assistantId, phoneNumberId, customerNumber]);

  const label =
    state.status === "loading"
      ? loadingLabel ?? "Calling Vapi…"
      : state.status === "success"
        ? successLabel?.(state.callId) ?? "Outbound call started"
        : state.status === "error"
          ? state.message
          : "Start Vapi call";

  return (
    <>
      {children(state)}
      {state.status === "idle" && (
        <button
          type="button"
          onClick={startCall}
          disabled={!assistantId || !phoneNumberId || !customerNumber}
          className="w-full bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/40 text-white font-bold py-2.5 rounded-xl transition shadow-lg text-xs"
        >
          {label}
        </button>
      )}
    </>
  );
}
