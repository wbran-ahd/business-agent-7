import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

/* ------------------------------------------------------------------ */
/* Validators                                                          */
/* ------------------------------------------------------------------ */
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
});

const budgetValidator = v.object({ category: v.string(), limit: v.number() });

const recurringValidator = v.object({
  id: v.string(),
  label: v.string(),
  amount: v.number(),
  enabled: v.boolean(),
});

/** Guard rail so a huge ledger never blows a single mutation. */
const MAX_RECORDS = 1000;

async function getSettingsDoc(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */
/** Cloud copy of the ledger for the signed-in user (null when signed out). */
export const listRecords = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const rows = await ctx.db
      .query("records")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((row) => ({
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
    }));
  },
});

/** Replace the whole cloud ledger with the caller's local ledger. */
export const replaceRecords = mutation({
  args: { records: v.array(recordValidator) },
  handler: async (ctx, { records }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("سائن ان کریں تاکہ کلاؤڈ سینک ممکن ہو۔");

    const existing = await ctx.db
      .query("records")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    for (const record of records.slice(0, MAX_RECORDS)) {
      await ctx.db.insert("records", { userId, ...record });
    }
    return { synced: Math.min(records.length, MAX_RECORDS) };
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
    return { ok: true };
  },
});

export const setGeminiKey = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("سائن ان کریں تاکہ اے آئی کی سیو ممکن ہو۔");
    const trimmed = key.trim();
    const doc = await getSettingsDoc(ctx, userId);
    if (doc) {
      await ctx.db.patch(doc._id, { geminiKey: trimmed });
    } else {
      await ctx.db.insert("userSettings", { userId, geminiKey: trimmed });
    }
    return { ok: true };
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
    return { hasKey: Boolean(doc?.geminiKey || process.env.GEMINI_API_KEY) };
  },
});

/**
 * Read the caller's stored Gemini key. Internal so the key never leaves the
 * server — only the AI action reads it.
 */
export const getStoredGeminiKey = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const doc = await getSettingsDoc(ctx, userId);
    return doc?.geminiKey ?? null;
  },
});
