# ADR — «صوتی بقیہ» کا ڈوئل بیک اینڈ فیصلہ (Convex بمقابلہ Firebase/Firestore)

> **اردو خلاصہ:** ایپ آج صرف Firestore استعمال کرتی ہے؛ Convex کا مکمل بیک اینڈ 코드 میں موجود ہے مگر کلائنٹ اسے صفر جگہ کال کرتا ہے۔ فیصلہ: دونوں کی ذمہ داریاں الگ پٹریوں پر رکھیں — *Firestore = واحد ledger/سینک سُچ؛ Convex = صرف سرور-سائیڈ AI (کی کفالت، کوٹہ، کیش)*۔Convex کے من مانی `records`/`syncState` ٹیبل حذف کیے جائیں تاکہ «دو سچ» کا خطرہ (R1) مکمل ختم ہو۔

| | |
|---|---|
| **Status** | Proposed (SAU-501 / SAU-502) — implementation awaits the owner's go-ahead |
| **Date** | 2026-10-27 |
| **Decides** | Which backend owns what — consolidation vs. clear separation |
| **Supersedes** | Nothing (first ADR; the implicit "both, undocumented" status quo is superseded) |
| **Related** | `docs/AUDIT-REPORT-URDU.md` (فاز 2/5، بونس C/D: SAU-501/502، R1)، `docs/FIREBASE-SETUP.md`، `src/convex/`, `src/hooks/use-sync.ts`, `src/hooks/use-auth.ts` |

---

## 1. Context — why this decision exists

The app is an Urdu voice finance ledger (`sauti-baqaya`) with two enormous classes of risk the audit
ranked highest: money/ledger data silenced by confusion (R1, 🔴) and a leaked or drained Gemini API
key (R2/R3, 🟠). The codebase currently carries **two complete backends** for overlapping jobs, and
nothing documents which one is real. This ADR fixes that.

Two extra constraints shape the decision:

1. **The audience and the data.** The target user is a low-end Android/3G Urdu phone opening a
   ledger of real cash. A data-migration regression in the ledger lane is the most expensive mistake
   this product can make; it must effectively never be attempted speculatively.
2. **The platform reality.** Production hosting is Firebase Hosting (`deploy.yml`), the app keeps
   working offline/local-first, and a working AI tier needs *server-resident* key custody and a
   daily quota — things the browser can never honestly provide, no matter how the client code is
   dressed up (audit 2.1/2.3).

---

## 2. Current state (verified against the source, 2026-10-27)

### 2.1 The live path: Firebase/Firestore does everything the user touches

| Concern | Implementation | Notes |
|---|---|---|
| Identity | `src/hooks/use-auth.ts` — **Firebase anonymous auth**, silent one-time bootstrap | No login screen by design ("silent data safeguard": f48b762 removed activation/login); `users/{uid}` scoping |
| Ledger records | `users/{uid}/records` — manual **upload/download** from `use-sync.ts` (batches of 250, client-side prune after upload) | `onSnapshot` listeners keep `CloudRow[]`; a **user-pushed button**, not background sync |
| Sync version | `users/{uid}/sync/state` (`version`, `updatedAt`) | Read-only counter; the client rejects an upload only when the cloud moved *and* the user hasn't downloaded. Nothing server-side enforces version — last writer wins (SAU-502) |
| Cloud settings | `users/{uid}/settings/current` (`budgets`, `recurring`, `updatedAt`) | Merged writes; also mirrored to `sauti_local_*` localStorage keys |
| Gemini key | **Device-local only** — `sauti_gemini_key` in localStorage (SAU-201 fix: the plaintext Firestore write was deleted) | The comment in `use-sync.ts` explicitly points here for a server-side home |
| AI advisor | `src/features/ai-advisor/hooks/useAiAdvisor.ts` — a **local deterministic stub** (a fixed heuristic, artificial 800 ms delay) | Never calls any backend; AI_DAILY_LIMIT in the UI is pure display |
| Rules | `firestore.rules` present, **no emulator test, not in CI** (SAU-202) | The largest untested security surface in the live path |

### 2.2 The dormant twin: a complete Convex backend, zero client calls

`src/convex/` contains a full second backend that the client **never invokes** — zero imports of
`api`/`ConvexHttpClient` outside `_generated`, no `ConvexClientProvider` in `src/main.tsx`:

| Piece | File(s) | What it would give |
|---|---|---|
| Schema | `src/convex/schema.ts` | `users`, **`records`**, **`syncState`**, `userSettings` (incl. encrypted `geminiKey`, quota, `appliedKeys`), `aiCache` |
| Duplicate ledger lane | `src/convex/sync.ts` (listRecords/syncRecords/saveSettings/version…) | Optimistic-concurrency `syncState`, `localId` allocation, recurring materialisation (`applyRecurringNow` + daily `applyRecurringAll` cron with `MAX_CRON_USERS`) |
| AI tier | `src/convex/ai.ts` + `crypto.ts` | `"use node"` action calling Gemini with model fallbacks, AES-GCM `SAUTI_KEY_SECRET` key custody (never to the browser), honest `unavailable` fallback, per-user **daily quota enforced server-side** (checked before the call, consumed only after an answer), hash-keyed response cache |
| Auth | `src/convex/auth/*`, `auth.config.ts`, `users.ts` | `@convex-dev/auth` incl. email OTP — orphaned after login systems were removed from the client |

History check: the platform bundle in `isolate/assets/` shows an earlier build whose client
**did** call `api.sync.*` (e.g. `setGeminiKey`, `aiStatus`, `syncRecords`). So the divergence is not
hypothetical dead code — it is a **previously live second backend** that one commit later lost its
entire client while every server file stayed behind.

### 2.3 Why this is dangerous (the audit's R1, stated plainly)

- The two worlds define overlapping-but-different truths: Convex `records`/`syncState` vs Firestore
  `users/{uid}/records`/`sync/state`; Convex `userSettings` (budgets/recurring/quota/encrypted key)
  vs Firestore `settings/current` (budgets/recurring) vs two localStorage mirrors. Adding a feature
  tomorrow, an AI helper or a teammate can pick either lane, and the first real multi-device user
  will surface the conflict as a silently altered ledger.
- **Server-side guarantees exist only in the lane nobody uses** (quota enforcement, encrypted key
  custody, transaction-style sync). The live lane's only server guarantees are Firestore rules —
  which are untested.
- CI keeps typechecking the dormant Convex code, so it *looks* maintained while being a parallel
  universe.

---

## 3. Options considered

### Option A — Consolidate on Convex (port the live lane off Firebase)

Make Convex the one backend: reactive queries replace manual upload/download, `syncState` gives real
optimistic concurrency, recurring materialisation, email OTP, and the AI tier come for free.

**Pros**
- One backend instead of two: no duplicate sync models, no parallel schema to keep aligned.
- The strongest sync model in the repo (server-checked versions, transactions possible) becomes
  the live one.
- AI/quota/key-custody code is already written and typechecked.

**Cons**
- **Data migration for real ledgers.** Anonymous Firebase `uid`s would have to map onto Convex user
  ids or every existing cloud record becomes unreachable. Doing this safely for anonymous,
  unverified identities (no email to recover from) is the hardest part and touches money data.
- Firebase is not just the sync path today: it is also the production deploy target, the PWA-era
  tooling and (potentially) phone auth later. Keeping it costs nothing; unwinding it costs a lot.
- Client `use-sync.ts`/`use-auth.ts` rewrite + re-verification of every sync path; large diff on the
  most sensitive file in the app.
- Convex pricing/quota becomes load-bearing for the ledger, the app's least replaceable feature.

**Verdict:** the "architecturally cleanest" answer and the wrong first move. Highest failure cost,
paid in the lane where the user is least able to recover.

### Option B — Consolidate on Firestore (delete Convex entirely)

Delete `src/convex/`, both dependencies, and accept that AI stays a client-side stub or moves to a
Firebase Cloud Function.

**Pros**
- The simplest possible answer to R1: two truths become one because the second one is gone.
- Small live lane = small attack surface. The repo stops typechecking and shipping a phantom
  backend; bundle/CI noise drops.
- No migration (the live path is already Firestore).

**Cons**
- Destroys the only working implementation of server-resident Gemini key custody, honest quota
  enforcement and response caching. Rebuilding that on Firebase means new Cloud Functions code, a
  new deploy pipeline, and its own secret management — new infrastructure written under time
  pressure for a security-critical job, which is exactly what the audit says not to do.
- Server-side recurring income (a real feature users rely on: income that materialises even if the
  phone never opens the app) would need another Cloud Function + Firestore transaction — again new
  code vs. existing written-and-reviewed code.
- The AI advisor would remain a lie ("AI se tahlil karein" button that runs a formula) or need
  urgent replacement.

**Verdict:** cheapest for R1, but reopens R2/R3 and un-builds a working security tier.

### Option C — Clear separation: one lane per concern (recommended)

Each responsibility lives in exactly one backend, enforced by the dossier below — and, critically,
the *duplicated* Convex lanes are deleted so overlap becomes impossible rather than merely
discouraged.

| Lane | Owner | Contents |
|---|---|---|
| **Ledger / sync / identity (source of truth)** | **Firestore** | everything currently live: anonymous auth, `records`, `sync/state`, `settings/current`, rules |
| **Platform services (no user data at rest except the encrypted key)** | **Convex** | `ai.ts` (Gemini action, AES-GCM key custody, quota, cache), `crypto.ts`, keep `userSettings` **only** for `geminiKey` + `aiDay`/`aiCalls` (and `appliedKeys`/recurring **only if** recurring moves onto Convex — see §5) |
| **Local-first fallback** | browser | localStorage persistence, device key (unchanged) |

**Pros**
- R1 (two truths for the ledger) dies structurally: Convex `records` + `syncState` are deleted, so
  no import, no helper, no future AI-generated "clean-up" can connect a second sync lane. The
  remaining Convex surface cannot disagree with Firestore because it stores nothing the ledger
  reads.
- The live path is untouched (zero migration, zero risk to the money data) while the *security
  tier* finally becomes wired instead of aspirational: `saveGeminiKey` gets its promised server
  home, `useAiAdvisor`'s stub gets replaced by a call to `sync.analyze`, quota displays become true.
- Keeps the already-written, already-typechecked security code; docs the boundary once so phase-3
  work (segment modes, billing) inherits lanes instead of debates.
- Cheap and reversible: deleting dormant Convex tables is a schema edit; nothing live depends on it.

**Cons**
- A thin client binding layer for AI has to be added (ConvexClientProvider + a slim `useAiQuota`),
  i.e. the repo goes from "Convex entirely unwired" to "Convex wired for one job" — slightly odd to
  explain to newcomers, hence this ADR and the ownership banners in §5.
- Two backends remain in the dependency tree (both already ship today), so the audit's dead-weight
  critique is only partially addressed until Option B is revisited later (§6).
- Whoever wires AI must decide where anonymous users' keys live — device vs Convex — and honor the
  rule that a user's key is never needed to run checks against the project `GEMINI_API_KEY`.

---

## 4. Decision

**Adopt Option C, with B as the explicit long-term re-evaluation point.** In one sentence:

> Firestore is the only publication/ledger backend and the only store of anything the ledger reads;
> Convex is admitted as a server-side-only platform tier for AI (key custody, quota, cache), and its
> duplicate ledger/sync tables are deleted this sprint, not "later".

Rationale, in audit language:

1. **SAU-501 asks for a decision and an ADR; this is both.** The decision that makes every other
   audit item well-defined is "no duplicate state" — enforcement (C) beats consolidation (A) badly
   and beats a lone deletions pass (B) on security.
2. **R1 is a divergence problem, not a backend-count problem.** Two backends that talk about
   different subjects (money vs AI) do not conflict; two backends that both store `records` do.
   C deletes the overlap instead of migrating or nuking a working security tier.
3. **The highest-remaining security items (SAU-201 follow-through, SAU-203 truthfulness, SAU-202)
   are all solvable inside C** without touching the ledger lane: rules tests (SAU-202) plus a
   rules-condition or transaction on the upload (SAU-502's server-side part) harden the live lane;
   the Convex tier handles only the key/quota half.
4. **Cost and safety.** The only irreversible work in A (anonymous-uid migration of ledger data) is
   precisely the work C avoids entirely; the only new code in C is a thin read-side client provider
   for AI.

---

## 5. Consequences + implementation plan

### Phase 1 — remove divergence (this sprint, low risk; code-only)

1. Delete from `src/convex/schema.ts`: `records` and `syncState` tables and their indexes.
   Slim `src/convex/sync.ts` down to whatever remains genuinely shared (`userSettings`
   key/quota helpers, `cacheKeyFor`, AI cache, `aiStatus`) or delete it outright if nothing but AI
   storage survives; delete `applyRecurringAll`/`applyRecurringNow` **only after** §5-phase-3
   decides recurring's owner (below) — until then they are doc-flagged dormant, since they are
   the one server-side recurring mechanism that exists anywhere.
2. Add a short ownership banner (a two-line comment) at the top of:
   `src/hooks/use-sync.ts` ("SOURCE OF TRUTH for ledger + version + settings; no other write path
   may exist"), `src/convex/ai.ts` ("AI-only tier; must not touch ledger storage"), and
   `firestore.rules` ("every ledger read/write scoped to users/{uid}").
3. `bun run typecheck` + `bun run test` green; no client behavioral change.

### Phase 2 — make the AI tier real (low risk, high payoff)

4. Mount a `ConvexClientProvider` (lazy, co-located with observability loading) and replace the
   `useAiAdvisor` stub's `runAi` with an action call; keep the stub as the offline/error fallback so
   the button never 404s into darkness.
5. `saveGeminiKey_DEVICE` becomes "device key by default; 'save to server' opt-in writes through
   `sync.setGeminiKey` (AES-GCM)", per the promise already written in `use-sync.ts`'s comment. The
   UI quota line starts reading `aiStatus` so the number shown is the enforced one.
6. Acceptance: the 26th AI call in a day is refused server-side (SAU-203's original criterion); with
   `SAUTI_KEY_SECRET` set, no plaintext key exists anywhere retrievable (SAU-201); with it unset, the
   behavior degrades exactly as today (device key only).

### Phase 3 — harden the live lane (the SAU-502 half)

7. Put an emulator rules suite in CI for the ≥8 cases the audit names (SAU-202) — the ledger lane's
   server-side guarantee finally *is* server-side.
8. Decide the upload version check: either a rules write-condition on `sync/state`
   (`request.resource.data.version == resource.data.version + 1`), or move the version bump into a
   single `runTransaction`-shaped function in `use-sync.ts`. Recurring's owner lands here too:
   either Firestore rules + a scheduled function, or the existing Convex cron is promoted and
   documented as the second (and only) exception to "Firestore owns scheduling".
9. Landing this ADR's file names the dates; a follow-up ticket carries the checklist.

### Ongoing

10. §6 checkpoint: when the AI tier has been live for a quarter, re-run Option A vs B with real
    usage data; if Convex's price/model fit is poor, B (delete) is now a *decision* rather than a
    security panic, because C has already deleted the ledger overlap that made B dangerous to undo.

### What we explicitly give up / accept

- Convex remains a second service with its own cost line until §6 re-evaluates it.
- `appliedKeys`/recurring keeps living in a place that could be pruned later; the sprint-1 pruning
  already made it bounded, so this is a tidiness debt, not a growth risk.
- Until phase 2 lands, the AI button still runs the documented local stub rather than making a
  new promise.
- The dual-mode *segment* system (`docs/DUAL-MODE.md`) is about household/shop modes and stays
  completely orthogonal to this ADR — no lane assignment touches it.

---

## 6. Review triggers

Revisit this ADR if any of the following becomes true:

- Convex's recurring cron or AI is being asked for material ledger features (direction change →
  reconsider A seriously, with a real migration plan drafted);
- a quarter of AI usage shows Convex is not worth a second service (→ B);
- Firestore rules tests expose rules cannot express the sync-state condition needed (→ revisit
  phase-3 mechanics);
- the product commits to server-side billing or staff roles — at that point the identity lane
  needs a real re-decision, not a quiet extension.
