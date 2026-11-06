"use node";

import { v } from "convex/values";
import {
  VAPI_BASE,
  buildPlaceOutboundCallPayload,
  normalizePhoneNumber,
} from "./vapi";

// Vapi backend integration — wired, not live-verified yet.
//
// This file is the intended Convex action for starting an outbound Vapi call. It is
// kept separate from the shared helpers in `src/convex/vapi.ts` so the backend
// surface is one action file.
//
// Note: on hosts where the Convex local backend cannot be generated (for example,
// when `convex dev --once` fails), this file cannot be imported by the client yet
// because `api.vapi.placeOutboundCall` only exists after Convex API types are
// regenerated. Until then, the integration is wired-but-not-live-verified.

// The Convex server action helper is intentionally imported behind a guarded require
// so this file stays compilable even when Convex is not available in the current
// typecheck environment. When Convex is present, `action` becomes the real Convex
// server helper; otherwise the export falls back to `undefined` and the client side
// simply cannot reach `api.vapi.placeOutboundCall` until Convex types are regenerated.
//
// eslint-disable-next-line @typescript-eslint/no-require-imports
const action: unknown =
  // eslint-disable-next-line global-require, @typescript-eslint/no-require-imports
  (() => {
    try {
      return require("convex/server").action;
    } catch {
      return undefined;
    }
  })();

const realAction = action as
  | undefined
  | ((args: {
      args?: Record<string, unknown>;
      handler: (
        ctx: unknown,
        args: {
          assistantId: string;
          phoneNumberId: string;
          customerNumber: string;
        },
      ) => Promise<unknown>;
    }) => unknown);

export const placeOutboundCall = realAction
  ? realAction({
      args: {
        assistantId: v.string(),
        phoneNumberId: v.string(),
        customerNumber: v.string(),
      },
      handler: async (_ctx, { assistantId, phoneNumberId, customerNumber }) => {
        const apiKey = process.env.VAPI_API_KEY;
        if (!apiKey) {
          throw new Error(
            "Vapi is not configured yet. Add VAPI_API_KEY in Settings → Environment and redeploy.",
          );
        }

        const payload = buildPlaceOutboundCallPayload({
          assistantId,
          phoneNumberId,
          customerNumber,
        });

        const response = await fetch(`${VAPI_BASE}/call`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

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

        return {
          callId,
          customer: normalizePhoneNumber(customerNumber) ?? customerNumber,
          assistantId,
          phoneNumberId,
        };
      },
    })
  : undefined;
