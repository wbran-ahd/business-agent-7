import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // add other tables here

    /**
     * Cloud backup of صوتی بقیہ ledger entries. One row per income/expense
     * record so the khata survives across devices and browser clears.
     * `localId` is the client's monotonic id and the sync upsert key.
     */
    records: defineTable({
      userId: v.id("users"),
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
    }).index("by_user", ["userId"]),

    /**
     * Optimistic-concurrency token for the ledger. A client must present the
     * version it last saw; a mismatch is reported as a conflict instead of
     * silently overwriting somebody else's newer records.
     */
    syncState: defineTable({
      userId: v.id("users"),
      version: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    /** Deduplicated Gemini responses, keyed by a hash of the request. */
    aiCache: defineTable({
      key: v.string(),
      userId: v.union(v.id("users"), v.null()),
      title: v.string(),
      spoken: v.string(),
      insight: v.string(),
      topCategory: v.string(),
      riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
      createdAt: v.number(),
    }).index("by_key", ["key"]),

    /** Per-user assistant settings: budgets, recurring incomes, AI key. */
    userSettings: defineTable({
      userId: v.id("users"),
      budgets: v.optional(
        v.array(v.object({ category: v.string(), limit: v.number() })),
      ),
      recurring: v.optional(
        v.array(
          v.object({
            id: v.string(),
            label: v.string(),
            amount: v.number(),
            enabled: v.boolean(),
          }),
        ),
      ),
      /** `monthKey|recurringId` pairs already materialised — idempotency. */
      appliedKeys: v.optional(v.array(v.string())),
      /** Gemini API key, AES-GCM encrypted when `SAUTI_KEY_SECRET` is set. */
      geminiKey: v.optional(v.string()),
      /** Rolling daily quota so a runaway client cannot drain the key. */
      aiDay: v.optional(v.string()),
      aiCalls: v.optional(v.number()),
    }).index("by_user", ["userId"])
  },
  {
    schemaValidation: false,
  },
);

export default schema;
