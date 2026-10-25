# Dual Mode — گھریلو + دکان

## فیصلہ

صوتی بقیہ **دونوں** قسم کے صارفین کو سپورٹ کرتا ہے:

| Mode | کون | کیا دیکھتا ہے |
|---|---|---|
| `household` | 🏠 گھریلو | بجٹ، ماہانہ خرچ، بچت کا مشورہ، رپورٹ |
| `shop` | 🏪 دکان | کھاتہ، گاہک/سپلائر، ادھار، اسٹاف PIN |
| `both` | 👥 دونوں | سب کچھ — **default** |

**`both` default کیوں؟** آج کی ایپ میں ہر سکرین ہر صارف کو نظر آتی ہے۔ اگر default `shop` یا `household` ہوتا تو یہ ماڈیول جوڑتے ہی موجودہ صارفین سے کچھ سکرین غائب ہو جاتیں — یعنی UI تبدیل ہو جاتی، جو منع ہے۔ `both` آج کے رویّے کو حرف بہ حرف محفوظ رکھتا ہے۔

---

## کوڈ میں کیا موجود ہے (اور کیا نہیں)

| فائل | کیا دیتی ہے |
|---|---|
| [src/lib/mode.ts](../src/lib/mode.ts) | `SegmentMode`, `DEFAULT_MODE`, `ModeFeatures`, `getFeatures()`, `hasFeature()`, `parseMode()`, `readUserMode()` |
| [src/hooks/use-mode.ts](../src/hooks/use-mode.ts) | `useMode(userId)` → `{ mode, features, hasFeature }` |
| [src/lib/feature-flags.ts](../src/lib/feature-flags.ts) | `shouldShow()`, `shouldLoad()` |

**جو نہیں ہے:**

- ❌ کوئی سکرین `useMode()` استعمال نہیں کرتی
- ❌ `sync` میں کوئی feature-gated load نہیں
- ❌ Firestore میں `mode` لکھا نہیں جاتا
- ❌ کوئی نئی سکرین، رنگ، فونٹ، لیبل یا route نہیں

یعنی آج runtime پر کچھ نہیں بدلا۔ یہ صرف وہ انٹرفیس ہے جس پر فیز 3+ کا کام کھڑا ہوگا۔

---

## Feature matrix

| Feature | گھریلو | دکان | دونوں | آج کوڈ میں موجود؟ |
|---|:---:|:---:|:---:|---|
| `householdBudget` | ✅ | ❌ | ✅ | ہاں — `lib/insights.ts`, `budget-notices.ts`, `Alerts.tsx` |
| `monthlyReports` | ✅ | ✅ | ✅ | ہاں — `lib/export-report.ts` |
| `savingsGoals` | ✅ | ❌ | ✅ | جزوی — بچت کا مشورہ موجود، باقاعدہ "ہدف" نہیں |
| `creditBook` | ❌ | ✅ | ✅ | ہاں — `lib/parties.ts`, `use-parties.ts` |
| `parties` | ❌ | ✅ | ✅ | ہاں — `ShopPanel.tsx` |
| `stockReminders` | ❌ | ✅ | ✅ | ہاں — `lib/insights.ts` |
| `staffAccounts` | ❌ | ✅ | ✅ | ہاں — `lib/staff-lock.ts`, `use-staff-lock.ts` |
| `dailySummary` | ✅ | ✅ | ✅ | ہاں — `lib/daybook.ts` |
| `voiceEntry` | ✅ | ✅ | ✅ | ہاں — `use-voice-assistant.tsx` |
| `aiAdvisor` | ✅ | ✅ | ✅ | ہاں — `features/ai-advisor` |

> `savingsGoals` کے لیے flag موجود ہے مگر باقاعدہ goal-setting UI نہیں۔ جب وہ feature بنے گا، flag پہلے سے تیار ملے گا — یہ جان بوجھ کر ہے، دھوکہ نہیں۔

---

## ڈیٹا ماڈل (فیز 3)

```
users/{uid}
  ├─ id, name, email, isAnonymous, createdAt   ← آج موجود
  └─ mode: "household" | "shop" | "both"        ← فیز 3 میں شامل
```

`readUserMode()` آج `users/{uid}.mode` **پڑھتا** ہے۔ فیلڈ نہ ہو تو `both`۔ کوئی schema تبدیل نہیں ہوتی، کوئی write نہیں ہوتی — اس لیے آج یہ مکمل no-op ہے۔

`parseMode()` ہر غیر متوقع ویلیو (`undefined`, پرانا نام, console سے ہاتھ سے بدلی گئی چیز) کو `both` بنا دیتا ہے۔ کسی بھی حالت میں render crash نہیں ہو سکتا۔

### Mode کب لکھا جائے گا

فیز 3 میں، جب:
1. صارف پہلی بار داخل ہو تو ایک واضح سوال — "آپ کھاتہ گھر کے لیے رکھتے ہیں یا دکان کے لیے؟"
2. Settings میں تبدیلی کا راستہ ہو
3. Firestore rules `mode` کو صرف مالک کی write تک محدود کریں

**یہ UI تبدیلی ہے — آپ کی منظوری کے بغیر نہیں ہوگی۔**

---

## استعمال کا اصول (فیز 3+)

```tsx
// ⚠️ مثال — آج کسی فائل میں نہیں
const { hasFeature } = useMode(user?.uid);

return (
  <div>
    {hasFeature("creditBook") && <CreditBook />}
    {hasFeature("householdBudget") && <BudgetWidget />}
  </div>
);
```

قواعد:

1. **UI پتھر پر لکھی ہے** — flag لگانے سے پہلے اسکرین کا نام، جگہ اور الفاظ طے ہوں اور منظوری ہو۔
2. **ایک ہی سچ** — `shouldShow()` اور `shouldLoad()` ایک ہی matrix پڑھتے ہیں، تاکہ چھپی ہوئی چیز لوڈ نہ ہو اور دکھائی گئی چیز بغیر ڈیٹا کے نہ ہو۔
3. **صرف UI پر بھروسہ نہیں** — جب billing یا plan آئے گا تو گھریلو صارف کو دکان کی API سرور پر بھی بند ہونی چاہیے۔ Client flag سیکیورٹی نہیں ہے۔
4. **Default بدلنا ممنوع** — `DEFAULT_MODE` بدلنے کا مطلب ہے موجودہ صارفین کی UI بدلنا۔

---

## ٹیسٹ

`bun run test` (scripts/verify-scaffolding.ts) یہ ثابت کرتا ہے:

- `getFeatures('household')` میں `creditBook === false`
- `getFeatures('shop')` میں `householdBudget === false`
- `getFeatures('both')` میں سب `true`
- `parseMode()` ہر غیر متوقع ویلیو کو `both` بناتا ہے
- `readUserMode()` ناقابلِ پڑھ ڈیٹا/خرابی پر `both` دیتا ہے اور `shop` پڑھ لیتا ہے
- `useMode(null)` پہلی render میں `both` دیتا ہے
- `shouldShow('creditBook', 'household') === false`

---

_آخری اپڈیٹ: فیز 0 (دونوں segment کے لیے logic) — کوئی UI تبدیل نہیں ہوئی۔_
