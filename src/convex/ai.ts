"use node";

/**
 * Gemini-powered financial analysis for صوتی بقیہ.
 *
 * Runs as a Convex Node action so the API key never reaches the browser:
 * the user's own key (saved from the in-app settings) wins, otherwise the
 * project's `GEMINI_API_KEY` from the Keys / API keys UI.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
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
});

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

function buildPrompt(input: {
  monthKey: string;
  totals: { carryForward: number; totalIncome: number; totalExpense: number; balance: number };
  categories: { category: string; amount: number; share: number }[];
  history: { monthKey: string; income: number; expense: number }[];
  question?: string;
}): string {
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

function fallbackInsight(): {
  title: string;
  spoken: string;
  insight: string;
  topCategory: string;
  riskLevel: "low" | "medium" | "high";
} {
  return {
    title: "ای آئی جائزہ",
    spoken: "ای آئی تجزیہ ابھی دستیاب نہیں، براہِ مہربانی سیٹنگز میں اپنی اے آئی کی چیک کریں۔",
    insight:
      "AI تجزیہ کے لیے Settings میں Gemini API Key درج کریں، یا پروجیکٹ کی Keys / API keys tab میں GEMINI_API_KEY سیٹ کریں۔",
    topCategory: "-",
    riskLevel: "low" as const,
  };
}

export const analyze = action({
  args: { input: analysisRequest },
  handler: async (ctx, { input }) => {
    let apiKey = await ctx.runQuery(internal.sync.getStoredGeminiKey, {});
    if (!apiKey) apiKey = process.env.GEMINI_API_KEY ?? "";
    if (!apiKey) return fallbackInsight();

    const body = JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(input) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.7,
        maxOutputTokens: 600,
      },
    });

    let lastError = "";
    for (const model of MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body,
          signal: AbortSignal.timeout(45_000),
        });

        if (!response.ok) {
          lastError = `${model}: HTTP ${response.status}`;
          continue;
        }

        const payload: unknown = await response.json();
        const text = extractText(payload).trim();
        if (!text) {
          lastError = `${model}: خالی جواب`;
          continue;
        }

        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          const risk = String(parsed.riskLevel ?? "low").toLowerCase();
          return {
            title: String(parsed.title ?? "ای آئی جائزہ"),
            spoken: String(parsed.spoken ?? ""),
            insight: String(parsed.insight ?? ""),
            topCategory: String(parsed.topCategory ?? "-"),
            riskLevel:
              risk === "high" || risk === "medium" || risk === "low"
                ? (risk as "low" | "medium" | "high")
                : ("low" as const),
          };
        } catch {
          return {
            title: "ای آئی جائزہ",
            spoken: text.slice(0, 180),
            insight: text,
            topCategory: "-",
            riskLevel: "low" as const,
          };
        }
      } catch (error) {
        lastError = `${model}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    throw new Error(`Gemini جائزہ ناکام: ${lastError || "کوئی مدل دستیاب نہیں"}`);
  },
});
