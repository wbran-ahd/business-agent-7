# صوتی بقیہ — Urdu Voice Finance Assistant

Bol kar khata: speak an income or expense in Urdu and صوتی بقیہ records it,
confirms it aloud, watches the budget and turns the month into a report.

## 🚀 Live Demo

**▶ [Open the live preview](https://site-f9ff23f69f4a4445a559ab1a2a03f28f.freebuff.page)**

| Screen | Path |
| --- | --- |
| Ledger / Desk (entry point) | [/](https://site-f9ff23f69f4a4445a559ab1a2a03f28f.freebuff.page/) |
| Old dashboard links | [/dashboard](https://site-f9ff23f69f4a4445a559ab1a2a03f28f.freebuff.page/dashboard) → redirects to `/` |

The deployment is the production bundle of `main`, served as a static SPA with
`index.html` as the fallback for unknown paths; the static worker and deploy
manifest live in [`deploy/`](deploy/). Build it the same way locally:

```bash
bun install          # install dependencies (bun.lock is committed)
bun run dev          # http://localhost:3000
bun run typecheck    # tsc -b --noEmit
bun run test         # ledger + scaffolding checks
VITE_PUBLIC_ORIGIN=https://<your-origin> bun run build   # production bundle in dist/
```

## Overview

This project uses the following tech stack:
- Vite
- Typescript
- React Router v7 (all imports from `react-router` instead of `react-router-dom`)
- React 19 (for frontend components)
- Tailwind v4 (for styling)
- Shadcn UI (for UI components library)
- Lucide Icons (for icons)
- Firebase (Firestore for cloud backup & sync, Firebase Auth for authentication)
- Framer Motion (for animations)
- Three js (for 3d models)

All relevant files live in the 'src' directory.

Use bun for the package manager.

## Setup

This project is set up already and running on a cloud environment.

## Environment Variables

`.env.example` lists every variable. None of them are secrets at build time —
Vite inlines `VITE_*` values into the bundle — so a preview build only needs the
public ones.

**Build-time (Vite, public):**

| Variable | Required for a deploy? | Purpose |
| --- | --- | --- |
| `VITE_PUBLIC_ORIGIN` | yes for share previews | Absolute origin used for `og:url` / `og:image`; unset leaves them relative |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | optional | Firebase web config; falls back to the committed `firebase-applet-config.json`, so the app boots without them. Set them to point a deployment at a different Firebase project |
| `VITE_SUPPORT_WHATSAPP` | optional | WhatsApp support line (E.164 digits, no `+`) shown in Settings |
| `VITE_TELEMETRY_URL` | optional | Telemetry ingest endpoint; unset disables sending |
| `VITE_VLY_APP_ID`, `VITE_VLY_MONITORING_URL` | platform-injected | Analytics/monitoring wiring for hosted builds |

**Cloud (Firebase):** the Firebase web config comes from the `VITE_FIREBASE_*`
variables above, falling back to the committed `firebase-applet-config.json`.
Firestore is the only remote store, so there is no separate server deployment
to configure or push to.

**Server-side (build scripts and integrations only):**

| Variable | Purpose |
| --- | --- |
| `SAUTI_KEY_SECRET` | AES-GCM key that encrypts the stored Gemini API key; unset stores it unencrypted |
| `VLY_INTEGRATION_KEY` | VLY integration key for AI and payment calls |
| `VLY_INTEGRATION_BASE_URL` | Integration gateway, defaults to `https://integrations.vly.ai` |

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request:

| Job | Command | Requires |
| --- | --- | --- |
| Typecheck | `bun install --frozen-lockfile`, then `bun run typecheck` | nothing |
| Ledger logic tests | `bun install --frozen-lockfile`, then `bun run test` | nothing |

`bun run test` runs `scripts/verify-khata.ts`: 205 assertions over amounts,
budgets, CSV round-trips, carry-forward ledgers and formatting. It needs no
deployment, so it gates every push to `main` as well as every pull request.


# Authentication

There is **no login, activation or licence gate**. Opening `/` mounts the
ledger directly; no sign-in form, activation screen or admin panel exists.

`src/hooks/use-auth.ts` silently mints an **anonymous Firebase session** in the
background and mirrors the `users/{uid}` profile document. That uid is what
keeps the owner-scoped Firestore rules working — the same device keeps the same
identity, so existing cloud data stays reachable without asking the user for
anything. If anonymous sign-in is unavailable the app stays fully usable
locally and cloud actions degrade.

There is no sign-out: dropping the anonymous session would create a new uid and
strand the device's cloud data.

## Using Auth in your components

You MUST use this hook to get user data. Never do this yourself without the hook:

```typescript
import { useAuth } from "@/hooks/use-auth";

const { isLoading, isAuthenticated, user } = useAuth();
```

Firestore access is scoped per uid under `users/{uid}/...`, and
`src/lib/firestore-errors.ts` centralises the error shape.

# Frontend Conventions

You will be using the Vite frontend with React 19, Tailwind v4, and Shadcn UI.

Generally, pages should be in the `src/pages` folder, and components should be in the `src/components` folder.

Shadcn primitives are located in the `src/components/ui` folder and should be used by default.

## Page routing

Your page component should go under the `src/pages` folder.

When adding a page, update the react router configuration in `src/main.tsx` to include the new route you just added.

## Shad CN conventions

Follow these conventions when using Shad CN components, which you should use by default.
- Remember to use "cursor-pointer" to make the element clickable
- For title text, use the "tracking-tight font-bold" class to make the text more readable
- Always make apps MOBILE RESPONSIVE. This is important
- AVOID NESTED CARDS. Try and not to nest cards, borders, components, etc. Nested cards add clutter and make the app look messy.
- AVOID SHADOWS. Avoid adding any shadows to components. stick with a thin border without the shadow.
- Avoid skeletons; instead, use the loader2 component to show a spinning loading state when loading data.


## Landing Pages

You must always create good-looking designer-level styles to your application. 
- Make it well animated and fit a certain "theme", ie neo brutalist, retro, neumorphism, glass morphism, etc

Use known images and emojis from online.

If the user is logged in already, show the get started button to say "Dashboard" or "Profile" instead to take them there.

## Responsiveness and formatting

Make sure pages are wrapped in a container to prevent the width stretching out on wide screens. Always make sure they are centered aligned and not off-center.

Always make sure that your designs are mobile responsive. Verify the formatting to ensure it has correct max and min widths as well as mobile responsiveness.

- Always create sidebars for protected dashboard pages and navigate between pages
- Always create navbars for landing pages
- On these bars, the created logo should be clickable and redirect to the index page

## Animating with Framer Motion

You must add animations to components using Framer Motion. It is already installed and configured in the project.

To use it, import the `motion` component from `framer-motion` and use it to wrap the component you want to animate.


### Other Items to animate
- Fade in and Fade Out
- Slide in and Slide Out animations
- Rendering animations
- Button clicks and UI elements

Animate for all components, including on landing page and app pages.

## Three JS Graphics

Your app comes with three js by default. You can use it to create 3D graphics for landing pages, games, etc.


## Colors

You can override colors in: `src/index.css`

This uses the oklch color format for tailwind v4.

Always use these color variable names.

Make sure all ui components are set up to be mobile responsive and compatible with both light and dark mode.

Set theme using `dark` or `light` variables at the parent className.

## Styling and Theming

When changing the theme, always change the underlying theme of the shad cn components app-wide under `src/components/ui` and the colors in the index.css file.

Avoid hardcoding in colors unless necessary for a use case, and properly implement themes through the underlying shad cn ui components.

When styling, ensure buttons and clickable items have pointer-click on them (don't by default).

Always follow a set theme style and ensure it is tuned to the user's liking.

## Toasts

You should always use toasts to display results to the user, such as confirmations, results, errors, etc.

Use the shad cn Sonner component as the toaster. For example:

```
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
export function SonnerDemo() {
  return (
    <Button
      variant="outline"
      onClick={() =>
        toast("Event has been created", {
          description: "Sunday, December 03, 2023 at 9:00 AM",
          action: {
            label: "Undo",
            onClick: () => console.log("Undo"),
          },
        })
      }
    >
      Show Toast
    </Button>
  )
}
```

Remember to import { toast } from "sonner". Usage: `toast("Event has been created.")`

## Dialogs

Always ensure your larger dialogs have a scroll in its content to ensure that its content fits the screen size. Make sure that the content is not cut off from the screen.

Ideally, instead of using a new page, use a Dialog instead. 
# Using the Firebase backend

This app has no HTTP server of its own. Firebase is the backend: Firebase
Auth silently provides an anonymous identity, Firestore holds the cloud copy of
the ledger, and Hosting serves the built SPA via
[`firebase.json`](firebase.json). Firestore rules govern access and are checked
in at [`firestore.rules`](firestore.rules).

## Data model

Everything is nested under the signed-in user's document, so one user can never
read another user's rows:

| Path | Holds | Written by |
| --- | --- | --- |
| `users/{uid}` | profile (name, email) | `src/hooks/use-auth.ts` |
| `users/{uid}/records` | income/expense ledger entries | `src/hooks/use-sync.ts` |
| `users/{uid}/settings/current` | budgets, recurring rules, AI key | `src/hooks/use-sync.ts` |
| `users/{uid}/sync/state` | sync version token | `src/hooks/use-sync.ts` |
| `users/{uid}/parties` | customers and suppliers | `src/hooks/use-parties.ts` |
| `users/{uid}/partyTxns` | shop (party) transactions | `src/hooks/use-parties.ts` |

The local device stays the source of truth. `src/lib/khata.ts` holds the ledger
in `localStorage` and `src/lib/parties.ts` holds the party book; Firestore is a
backup and cross-device mirror, not the primary store.

## Local-first conventions

- **Read from local state, write through.** Update the React state first, then
  push the same value to Firestore. Never block the UI on a network round-trip.
- **Write in batches.** Firestore accepts at most 500 operations per
  `writeBatch`; `src/hooks/use-sync.ts` chunks uploads at 250 so a large ledger
  cannot overflow the limit.
- **Treat a cloud write as best-effort.** A failed sync must not lose the
  user's entry. Log it and let the next upload retry.
- **Cap what you send.** `MAX_RECORDS` in `src/lib/khata.ts` bounds how many
  entries leave the device.

## Cloud sync

`useSync` is the single entry point for everything that touches the cloud:

- `upload()` — writes the local ledger to `users/{uid}/records` in chunks, then
  bumps the version in `users/{uid}/sync/state`, then prunes rows the device no
  longer has.
- `download()` — reads the cloud copy back into the local ledger.
- `persistSettings()` — saves budgets and recurring rules.
- `saveGeminiKey()` — stores the AI key locally, and in
  `users/{uid}/settings/current` when signed in.

`useParties` mirrors the same pattern for the customer/supplier book, using
`onSnapshot` for live updates.

## Security rules

[`firestore.rules`](firestore.rules) is the access control for the whole app.
`@firebase/eslint-plugin-security-rules` runs as part of `bun run lint`, so rule
regressions are caught before they ship. When you add a collection, add its
rule in the same change — a missing rule is a data leak, and a rule that does
not match the client path is a silent sync failure.
