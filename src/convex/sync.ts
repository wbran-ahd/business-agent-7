import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { decryptSecret, encryptSecret, hashPayload } from "./crypto";
import type { Id } from "./_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

/* ------------------------------------------------------------------ */
/* Constants & validators                                              */
/* ------------------------------------------------------------------ */
/** Guard rail so a huge ledger never blows a single mutation. */
const MAX_RECORDS = 1000;
/** Users touched per daily cron run — keeps each run comfortably short. */
const MAX_CRON_USERS = 500;
/** Gemini calls allowed per user per UTC day. */
const AI_DAILY_LIMIT = 25;
/** Cached insights stay fresh for this long. */
const AI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const accountKind = v.union(
  v.literal("cash"),
  v.literal("jazzcash"),
  v.literal("easypaisa"),
  v.literal("bank"),
);

const recordValidator = v.object({
  localId: v.number(),
  kind: v.union(v.literal("income"), v.literal("expense")),
  amount: v.number(),
  detail: v.string(),
  category: v.string(),
  icon: v.string(),
  monthKey: v.string(),
  date: v.string(),
  time: v.string(),
  timestamp: v.number(),
  account: v.optional(accountKind),
});

const budgetValidator = v.object({ category: v.string(), limit: v.number() });

const recurringValidator = v.object({
  id: v.string(),
  label: v.string(),
  amount: v.number(),
  enabled: v.boolean(),
  /* Optional so rules saved before expenses were supported keep working. */
  kind: v.optional(v.union(v.literal("income"), v.literal("expense"))),
});

type RecordRow = {
  localId: number;
  kind: "income" | "expense";
  amount: number;
  detail: string;
  category: string;
  icon: string;
  monthKey: string;
  date: string;
  time: string;
  timestamp: number;
  account?: "cash" | "jazzcash" | "easypaisa" | "bank";
};

function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getSettingsDoc(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function getSyncDoc(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("syncState")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** Upserts a batch of records by `localId`; shared by the single-shot and
 *  chunked upload mutations so both write rows identically. */
async function writeRecords(
  ctx: MutationCtx,
  userId: Id<"users">,
  incoming: RecordRow[],
): Promise<number> {
  if (incoming.length === 0) return 0;
  const existing = await ctx.db
    .query("records")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const byLocalId = new Map(existing.map((row) => [row.localId, row]));

  for (const record of incoming) {
    const match = byLocalId.get(record.localId);
    if (match) {
      const unchanged =
        match.kind === record.kind &&
        match.amount === record.amount &&
        match.detail === record.detail &&
        match.category === record.category &&
        match.monthKey === record.monthKey &&
        match.timestamp === record.timestamp &&
        match.account === record.account;
      if (!unchanged) await ctx.db.patch(match._id, { ...record });
    } else {
      await ctx.db.insert("records", { userId, ...record });
    }
  }
  return incoming.length;
}

/** Advances the optimistic-concurrency token after a successful write. */
async function bumpVersion(
  ctx: MutationCtx,
  userId: Id<"users">,
  sync: { _id: Id<"syncState">; version: number } | null,
): Promise<number> {
  const nextVersion = (sync?.version ?? 0) + 1;
  if (sync) await ctx.db.patch(sync._id, { version: nextVersion, updatedAt: Date.now() });
  else
    await ctx.db.insert("syncState", { userId, version: nextVersion, updatedAt: Date.now() });
  return nextVersion;
}

/* ------------------------------------------------------------------ */
/* Ledger sync — optimistic concurrency                                */
/* ------------------------------------------------------------------ */

/**
 * Cloud ledger for the signed-in user, together with the version token the
 * client must present on the next upload. `null` when signed out.
 */
export const listRecords = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const rows = await ctx.db
      .query("records")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const sync = await getSyncDoc(ctx, userId);
    return {
      version: sync?.version ?? 0,
      records: rows.map((row) => ({
        localId: row.localId,
        kind: row.kind,
        amount: row.amount,
        detail: row.detail,
        category: row.category,
        icon: row.icon,
        monthKey: row.monthKey,
        date: row.date,
        time: row.time,
        timestamp: row.timestamp,
        account: row.account,
      })) satisfies RecordRow[],
    };
  },
});

/**
 * Upload the caller's ledger.
 *
 * `baseVersion` is the version the client last downloaded. If the server has
 * moved on we return a conflict instead of deleting rows the client has never
 * seen — the old delete-everything-then-reinsert behaviour could destroy data.
 */
export const syncRecords = mutation({
  args: { records: v.array(recordValidator), baseVersion: v.number() },
  handler: async (ctx, { records, baseVersion }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("سائن ان کریں تاکہ کلاؤڈ سینک ممکن ہو۔");

    const sync = await getSyncDoc(ctx, userId);
    const currentVersion = sync?.version ?? 0;
    if (baseVersion !== currentVersion) {
      return { conflict: true, version: currentVersion, synced: 0 };
    }

    const existing = await ctx.db
      .query("records")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    /* Keep the newest rows. `slice(0, MAX_RECORDS)` used to keep the oldest,
       so every entry recorded after the first 1000 was silently dropped. */
    const incoming = records.slice(-MAX_RECORDS);
    const keep = new Set(incoming.map((record) => record.localId));

    for (const row of existing) {
      if (!keep.has(row.localId)) await ctx.db.delete(row._id);
    }

    const synced = await writeRecords(ctx, userId, incoming);
    const nextVersion = await bumpVersion(ctx, userId, sync);
    return { conflict: false, version: nextVersion, synced };
  },
});

/**
 * Appends/updates one chunk of the ledger without deleting anything.
 *
 * The client uploads in chunks and prunes only in a final `pruneRecords` call,
 * so a failure halfway through leaves the previous cloud backup intact. Every
 * chunk is version-checked; the returned version is the base for the next one.
 */
export const upsertRecords = mutation({
  args: { records: v.array(recordValidator), baseVersion: v.number() },
  handler: async (ctx, { records, baseVersion }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("سائن ان کریں تاکہ کلاؤڈ سینک ممکن ہو۔");

    const sync = await getSyncDoc(ctx, userId);
    const currentVersion = sync?.version ?? 0;
    if (baseVersion !== currentVersion) {
      return { conflict: true, version: currentVersion, synced: 0 };
    }

    const synced = await writeRecords(ctx, userId, records.slice(-MAX_RECORDS));
    const nextVersion = await bumpVersion(ctx, userId, sync);
    return { conflict: false, version: nextVersion, synced };
  },
});

/**
 * Deletes cloud rows the client no longer has, after a full upload. Pass the
 * complete set of local ids so a removal on one device reaches the others.
 */
export const pruneRecords = mutation({
  args: { keepLocalIds: v.array(v.number()), baseVersion: v.number() },
  handler: async (ctx, { keepLocalIds, baseVersion }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("سائن ان کریں تاکہ کلاؤڈ سینک ممکن ہو۔");

    const sync = await getSyncDoc(ctx, userId);
    const currentVersion = sync?.version ?? 0;
    if (baseVersion !== currentVersion) {
      return { conflict: true, version: currentVersion, pruned: 0 };
    }

    const keep = new Set(keepLocalIds.slice(-MAX_RECORDS * 2));
    const existing = await ctx.db
      .query("records")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    let pruned = 0;
    for (const row of existing) {
      if (!keep.has(row.localId)) {
        await ctx.db.delete(row._id);
        pruned += 1;
      }
    }

    /* Only bump the version when something actually changed, so a no-op prune
       never invalidates another device's base version. */
    if (pruned === 0) return { conflict: false, version: currentVersion, pruned };
    const nextVersion = await bumpVersion(ctx, userId, sync);
    return { conflict: false, version: nextVersion, pruned };
  },
});

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const doc = await getSettingsDoc(ctx, userId);
    return {
      budgets: doc?.budgets ?? [],
      recurring: doc?.recurring ?? [],
      appliedKeys: doc?.appliedKeys ?? [],
      hasGeminiKey: Boolean(doc?.geminiKey),
    };
  },
});

export const saveSettings = mutation({
  args: {
    budgets: v.array(budgetValidator),
    recurring: v.array(recurringValidator),
  },
  handler: async (ctx, { budgets, recurring }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("سائن ان کریں تاکہ سیٹنگز محفوظ ہوں۔");
    const doc = await getSettingsDoc(ctx, userId);
    if (doc) {
      await ctx.db.patch(doc._id, { budgets, recurring });
    } else {
      await ctx.db.insert("userSettings", { userId, budgets, recurring });
    }
    return { ok: true as const };
  },
});

export const setGeminiKey = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("سائن ان کریں تاکہ اے آئی کی سیو ممکن ہو۔");
    const trimmed = key.trim();
    const stored = await encryptSecret(trimmed);
    const doc = await getSettingsDoc(ctx, userId);
    if (doc) await ctx.db.patch(doc._id, { geminiKey: stored });
    else await ctx.db.insert("userSettings", { userId, geminiKey: stored });
    return { ok: true as const, encrypted: stored !== trimmed };
  },
});

/**
 * Whether an AI key is available to the caller: their own saved key, or the
 * project-level `GEMINI_API_KEY` from the Keys / API keys UI.
 */
export const aiStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const doc = userId === null ? null : await getSettingsDoc(ctx, userId);
    const hasKey = Boolean(doc?.geminiKey || process.env.GEMINI_API_KEY);
    const isToday = doc?.aiDay === new Date().toISOString().slice(0, 10);
    const used = isToday ? doc?.aiCalls ?? 0 : 0;
    return {
      hasKey,
      used,
      limit: AI_DAILY_LIMIT,
      remaining: Math.max(0, AI_DAILY_LIMIT - used),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Recurring entries — server side & idempotent                        */
/* ------------------------------------------------------------------ */
type RecurringRule = {
  id: string;
  label: string;
  amount: number;
  enabled: boolean;
  kind?: "income" | "expense";
};

async function materialiseRecurring(
  ctx: MutationCtx,
  doc: {
    _id: Id<"userSettings">;
    userId: Id<"users">;
    recurring?: RecurringRule[];
    appliedKeys?: string[];
  },
): Promise<number> {
  const monthKey = currentMonthKey();
  const applied = new Set(doc.appliedKeys ?? []);
  const due = (doc.recurring ?? []).filter(
    (entry) => entry.enabled && !applied.has(`${monthKey}|${entry.id}`),
  );
  if (due.length === 0) return 0;

  const existing = await ctx.db
    .query("records")
    .withIndex("by_user", (q) => q.eq("userId", doc.userId))
    .collect();
  let nextLocalId = existing.reduce((max, row) => Math.max(max, row.localId), 0);
  const now = Date.now();

  for (const entry of due) {
    nextLocalId += 1;
    applied.add(`${monthKey}|${entry.id}`);
    /* Rules default to income so settings saved before expenses were supported
       keep materialising exactly as they used to. */
    const kind = entry.kind ?? "income";
    await ctx.db.insert("records", {
      userId: doc.userId,
      localId: nextLocalId,
      kind,
      amount: entry.amount,
      detail: entry.label,
      category: kind === "income" ? "ماہانہ آمدنی" : "ماہانہ خرچہ",
      icon: kind === "income" ? "fa-money-bill-wave" : "fa-file-invoice-dollar",
      monthKey,
      date: "",
      time: "",
      timestamp: now,
    });
  }

  /* Bounded growth: only the current month's keys are ever consulted by the
     `due` filter above, so keys from older months are dead weight and pruned
     here instead of living in the settings document forever. */
  const kept = Array.from(applied).filter((key) => key.startsWith(`${monthKey}|`));
  await ctx.db.patch(doc._id, { appliedKeys: kept });
  return due.length;
}

/** Called by a client right after sign-in so the current month is up to date. */
export const applyRecurringNow = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { applied: 0 };
    const doc = await getSettingsDoc(ctx, userId);
    if (!doc) return { applied: 0 };
    return { applied: await materialiseRecurring(ctx, doc) };
  },
});

/** Safety net: runs daily so a device that never opened still gets its income. */
export const applyRecurringAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("userSettings").take(MAX_CRON_USERS);
    let applied = 0;
    for (const doc of all) applied += await materialiseRecurring(ctx, doc);
    return { applied, scanned: all.length };
  },
});

/* ------------------------------------------------------------------ */
/* Internal: AI key, quota and cache                                   */
/* ------------------------------------------------------------------ */
/** Returns the caller's decrypted Gemini key. Never exposed to the client. */
export const getStoredGeminiKey = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const doc = await getSettingsDoc(ctx, userId);
    if (!doc?.geminiKey) return null;
    return await decryptSecret(doc.geminiKey);
  },
});

export const getAiCache = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("aiCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!row) return null;
    if (Date.now() - row.createdAt > AI_CACHE_TTL_MS) return null;
    return {
      title: row.title,
      spoken: row.spoken,
      insight: row.insight,
      topCategory: row.topCategory,
      riskLevel: row.riskLevel,
    };
  },
});

export const putAiCache = internalMutation({
  args: {
    key: v.string(),
    userId: v.union(v.id("users"), v.null()),
    title: v.string(),
    spoken: v.string(),
    insight: v.string(),
    topCategory: v.string(),
    riskLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("unavailable"),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const payload = {
      title: args.title,
      spoken: args.spoken,
      insight: args.insight,
      topCategory: args.topCategory,
      riskLevel: args.riskLevel,
      createdAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, payload);
    else await ctx.db.insert("aiCache", { key: args.key, userId: args.userId, ...payload });
  },
});

export const consumeAiQuota = internalMutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { remaining: -1 };
    const doc = await getSettingsDoc(ctx, userId);
    const today = new Date().toISOString().slice(0, 10);
    const used = doc?.aiDay === today ? (doc?.aiCalls ?? 0) + 1 : 1;
    if (doc) await ctx.db.patch(doc._id, { aiDay: today, aiCalls: used });
    else await ctx.db.insert("userSettings", { userId, aiDay: today, aiCalls: used });
    return { remaining: Math.max(0, AI_DAILY_LIMIT - used) };
  },
});

/**
 * Reads the quota without spending it. The action checks this before calling
 * Gemini and only calls `consumeAiQuota` once a model answered, so a failed
 * request no longer burns the user's daily allowance.
 */
export const getAiQuota = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { remaining: -1, used: 0 };
    const doc = await getSettingsDoc(ctx, userId);
    const today = new Date().toISOString().slice(0, 10);
    const used = doc?.aiDay === today ? (doc?.aiCalls ?? 0) : 0;
    return { remaining: Math.max(0, AI_DAILY_LIMIT - used), used };
  },
});

/** Stable cache key for an analysis payload (shared with the action). */
export async function cacheKeyFor(payload: unknown): Promise<string> {
  return await hashPayload(JSON.stringify(payload));
}
