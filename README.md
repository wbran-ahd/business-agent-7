# Sauti Baqaya — Urdu Voice Finance Assistant

Voice-controlled bookkeeping for shopkeepers: income, expenses, balance, udhaar/party
tracking, monthly reports, and a financial assistant.

## Project layout

- `src/convex/` — Convex backend functions (auth, sync, AI analysis, recurring entries).
- `src/hooks/` — React hooks for ledger, sync, backup reminders, PWA, staff lock, voice.
- `src/lib/` — pure domain/formatting helpers: khata math, parties, daybook, i18n, tts.
- `src/features/` — UI features: ledger, analytics, settings, AI advisor, shop, voice-assistant.
- `scripts/` — local verification scripts for ledger and scaffolding behavior.

## Vapi integration

A server-backed outbound call integration has been wired so the app can start a Vapi
voice call from a saved assistant and phone number.

### Current scope

- Backend action intended: `src/convex/vapi-backend.ts`.
- Shared backend helpers: `src/convex/vapi.ts`.
- Client component: `src/features/voice-assistant/VapiOutboundCallButton.tsx`.

### What Vapi needs

- A Vapi account.
- An assistant created in the Vapi dashboard.
- An imported phone number connected to that assistant for outbound calls.
- A private Vapi API key added to the project environment as `VAPI_API_KEY`.
- Optional: `VAPI_API_BASE` if you need a non-default API base URL.

### Verification status

- **Not live-verified yet.**
- This workspace has no production hosting project yet, so production environment
  variables cannot be set from here yet.
- The first production deploy must be started from the project Deploy button before
  `VAPI_API_KEY` can be added as a production environment variable.
- After that first deploy, add `VAPI_API_KEY` in Settings → Environment, then the
  backend action and the client button can be verified against a real Vapi account.

### Recommended next step

1. Create an assistant and connected phone number in the Vapi dashboard.
2. Generate a private Vapi API key.
3. Deploy the project once from the Deploy button and choose a domain.
4. Add `VAPI_API_KEY` (and optional `VAPI_API_BASE`) in Settings → Environment.
5. Once the Convex backend can run again, regenerate client API types so the button can
   call the real Convex mutation instead of the direct REST fallback.
6. Confirm the button can start an outbound call and return a real `callId`.

## Development

Install, type-check, build, and verify:

```bash
bun install
bun run typecheck
bun run build
bun run test
```

## License

Private project.
