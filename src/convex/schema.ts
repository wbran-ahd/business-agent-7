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
    })
      .index("by_user", ["userId"])
      .index("by_user_local", ["userId", "localId"]),

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
      /** Gemini API key supplied by the user inside the app (never returned). */
      geminiKey: v.optional(v.string()),
    }).index("by_user", ["userId"])
  },
  {
    schemaValidation: false,
  },
);

export default schema;
