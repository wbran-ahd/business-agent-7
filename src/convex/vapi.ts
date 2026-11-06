"use node";

import { v } from "convex/values";

// Vapi backend integration: wired, not live-verified yet.
// This file exposes the non-Convex helper surface so the backend action and any
// future client code can stay typed even when Convex server helpers are not
// importable in typecheck on a given host.
//
// The actual Convex action lives in `src/convex/vapi-backend.ts`.

export const VAPI_BASE =
  (process.env.VAPI_API_BASE ?? "").trim().replace(/\/+$/, "") ||
  "https://api.vapi.ai";

export const VAPI_KEY_CONFIGURED = Boolean(process.env.VAPI_API_KEY);

/** Minimal international number cleanup. Not a phone-validation library. */
export function normalizePhoneNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    return "+".concat(digits.slice(2));
  }
  if (digits.startsWith("0") && digits.length >= 11) {
    // Heuristic for a local Pakistani number typed as `0300…`.
    // This project is Pakistan-first, so we only promote this specific shape.
    return "+92".concat(digits.slice(1));
  }
  if (digits.length >= 10) {
    return "+".concat(digits);
  }
  return null;
}

/** Planned backend shape for the Vapi outbound call mutation. */
export type VapiPlaceOutboundCallArgs = {
  assistantId: string;
  phoneNumberId: string;
  customerNumber: string;
};

export type VapiPlaceOutboundCallResult = {
  callId: string;
  customer: string;
  assistantId: string;
  phoneNumberId: string;
};

export function buildPlaceOutboundCallPayload({
  assistantId,
  phoneNumberId,
  customerNumber,
}: VapiPlaceOutboundCallArgs): Record<string, unknown> {
  const customer = normalizePhoneNumber(customerNumber);
  if (!customer) {
    throw new Error(
      "Phone number looks wrong. Use an international format like +923001234567.",
    );
  }

  return {
    assistantId,
    phoneNumberId,
    customer: { number: customer },
  };
}
