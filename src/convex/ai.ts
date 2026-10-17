"use node";

/**
 * Gemini-powered financial analysis for صوتی بقیہ.
 *
 * Runs as a Convex Node action so the API key never reaches the browser.
 * Resolution order: the user's own key (AES-GCM encrypted at rest), then the
 * project's `GEMINI_API_KEY` from the Keys / API keys UI.
 *
 * Two guards keep a single key from being drained:
 *   • a per-user daily quota (see `consumeAiQuota`)
 *   • a response cache keyed on a hash of the request (`getAiCache`)
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { hashPayload } from "./crypto";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

/** Newest stable flash models first, older ones as fallbacks. */
const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
];

const analysisRequest = v.object({
  monthKey: v.string(),
  totals: v.object({
    carryForward: v.number(),
    totalIncome: v.number(),
    totalExpense: v.number(),
    balance: v.number(),
  }),
  categories: v.array(
    v.object({ category: v.string(), amount: v.number(), share: v.number() }),
  ),
  history: v.array(
    v.object({ monthKey: v.string(), income: v.number(), expense: v.number() }),
  ),
  question: v.optional(v.string()),
  /** Pre-computed purchase insights from the client (budgets, fast movers). */
  purchaseHint: v.optional(v.string()),
});

type AnalysisInput = {
  monthKey: string;
  totals: { carryForward: number; totalIncome: number; totalExpense: number; balance: number };
  categories: { category: string; amount: number; share: number }[];
  history: { monthKey: string; income: number; expense: number }[];
  question?: string;
  purchaseHint?: string;
};

const riskValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  /* Not a financial judgement — the AI itself is unavailable. */
  v.literal("unavailable"),
);

const responseSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    spoken: { type: "STRING" },
    insight: { type: "STRING" },
    topCategory: { type: "STRING" },
    riskLevel: { type: "STRING" },
  },
  required: ["title", "spoken", "insight", "topCategory", "riskLevel"],
} as const;

function buildPrompt(input: AnalysisInput): string {
  const lines: string[] = [
    "آپ 'صوتی بقیہ' نامی اردو ذاتی مالی منشی ہیں۔",
    "نیچے دیے گئے حساب کے مطابق مختصر، عملی اردو مشورہ دیں۔",
    "جملے چھوٹے رکھیں، کوئی Markdown یا انگلش متن استعمال نہ کریں۔",
    "",
    `مہینہ: ${input.monthKey}`,
    `کل آمدنی: ${input.totals.totalIncome}`,
    `کل خرچہ: ${input.totals.totalExpense}`,
    `موجودہ بقایا: ${input.totals.balance}`,
    `پچھلا منتقل بقایا: ${input.totals.carryForward}`,
    "",
    "خرچے کی categories:",
    ...(input.categories.length > 0
      ? input.categories.map(
          (c) => ` - ${c.category}: ${c.amount} (فیصد ${c.share}%)`,
        )
      : [" - کوئی خرچہ درج نہیں"]),
    "",
    "پچھلے کچھ ماہ کا ہِساب:",
    ...(input.history.length > 0
      ? input.history.map(
          (h) => ` - ${h.monthKey}: آمدنی ${h.income}, خرچہ ${h.expense}`,
        )
      : [" - تاریخی ڈیٹا دستیاب نہیں"]),
    "",
    "fields:",
    ' - title: ایک خطاب، 5 الفاظ سے کم (مثلاً "اکتوبر کا ہِساب")',
    " - spoken: 2 جملوں سے کم، اردو، TTS کے لیے پڑھنے کے قابل",
    " - insight: 2 تا 4 جملے، بنیادی مشورہ اور رجحان",
    " - topCategory: سب سے بڑی خرچ category یا '-'",
    ' - riskLevel: "low" یا "medium" یا "high" (آمدنی سے زیادہ خرچ ہو تو high)',
  ];
  if (input.purchaseHint) {
    lines.push(
      "",
      "خریداری کے اعداد و شمار (ایپ نے خود نکالے ہیں):",
      input.purchaseHint,
      "ان اعداد کو مدنظر رکھتے ہوئے اسٹاک اور خریداری کے بارے میں ٹھوس مشورہ دیں۔",
    );
  }
  if (input.question) {
    lines.push("", `صارف کا سوال: "${input.question}" — اسی کا جواب دیں۔`);
  }
  return lines.join("\n");
}

function extractText(payload: unknown): string {
  const root = payload as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return root.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

type Insight = {
  title: string;
  spoken: string;
  insight: string;
  topCategory: string;
  riskLevel: "low" | "medium" | "high" | "unavailable";
};

/*
 * Honest fallback: the old version returned `riskLevel: "low"`, which made a
 * missing key look like a real “everything is fine” analysis. `unavailable`
 * renders as a neutral badge, never as a green all-clear.
 */
function fallbackInsight(): Insight {
  return {
    title: "اے آئی دستیاب نہیں",
    spoken:
      "اے آئی تجزیہ ابھی دستیاب نہیں۔ براہِ مہربانی سیٹنگز میں اپنی اے آئی کی چیک کریں۔",
    insight:
      "AI تجزیہ کے لیے Settings میں Gemini API Key درج کریں، یا پروجیکٹ کی Keys / API keys tab میں GEMINI_API_KEY سیٹ کریں۔",
    topCategory: "-",
    riskLevel: "unavailable",
  };
}

function normaliseInsight(raw: Record<string, unknown>): Insight {
  const risk = String(raw.riskLevel ?? "low").toLowerCase();
  const riskLevel: Insight["riskLevel"] =
    risk === "high" || risk === "medium" || risk === "low" || risk === "unavailable"
      ? risk
      : "low";
  return {
    title: String(raw.title ?? "ای آئی جائزہ"),
    spoken: String(raw.spoken ?? ""),
    insight: String(raw.insight ?? ""),
    topCategory: String(raw.topCategory ?? "-"),
    riskLevel,
  };
}

async function callGemini(apiKey: string, body: string): Promise<Insight | null> {
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        /* A silent `continue` hid wrong model ids, revoked keys and exhausted
           quotas. Log the status plus a short body so the failure is visible. */
        const body = (await response.text().catch(() => "")).slice(0, 200);
        console.warn(`[ai] ${model} failed: ${response.status} ${body}`);
        continue;
      }

      const text = extractText(await response.json()).trim();
      if (!text) continue;

      try {
        return normaliseInsight(JSON.parse(text) as Record<string, unknown>);
      } catch {
        return {
          title: "ای آئی جائزہ",
          spoken: text.slice(0, 180),
          insight: text,
          topCategory: "-",
          riskLevel: "low",
        };
      }
    } catch {
      // network / timeout — try the next model
    }
  }
  return null;
}

export const analyze = action({
  args: { input: analysisRequest },
  // Explicit annotations break the inference cycle that `internal` would
  // otherwise create between this action and the generated api types.
  handler: async (ctx, { input }): Promise<Insight> => {
    const key = await hashPayload(JSON.stringify(input));
    const cached = (await ctx.runQuery(internal.sync.getAiCache, { key })) as Insight | null;
    if (cached) return cached;

    let apiKey = await ctx.runQuery(internal.sync.getStoredGeminiKey, {});
    if (!apiKey) apiKey = process.env.GEMINI_API_KEY ?? "";
    if (!apiKey) return fallbackInsight();

    /* Check the quota without spending it — it is only consumed after a model
       actually answers, so a failed call no longer burns the daily allowance. */
    const quota = await ctx.runQuery(internal.sync.getAiQuota, {});
    if (quota.remaining === 0) {
      throw new Error("آج کی اے آئی کی حد ختم ہو چکی ہے — کل دوبارہ کوشش کریں۔");
    }

    const result = await callGemini(
      apiKey,
      JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(input) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
          temperature: 0.7,
          maxOutputTokens: 600,
        },
      }),
    );

    if (!result) throw new Error("Gemini جائزہ ناکام: کوئی مدل جواب نہیں دے سکا");

    await ctx.runMutation(internal.sync.consumeAiQuota, {});

    const userId = await getAuthUserId(ctx);
    await ctx.runMutation(internal.sync.putAiCache, {
      key,
      userId,
      title: result.title,
      spoken: result.spoken,
      insight: result.insight,
      topCategory: result.topCategory,
      riskLevel: result.riskLevel,
    });

    return result;
  },
});

/** Lets the client validate the shape before anything is stored. */
export const insightValidator = riskValidator;
