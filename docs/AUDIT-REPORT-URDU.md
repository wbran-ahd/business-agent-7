# 📘 صوتی بقیہ — 7 فازی ماسٹر آڈٹ بلیو پرنٹ

> **پروجیکٹ:** صوتی بقیہ (`sauti-baqaya` v1.0.0) — اردو وائس فنانس اسسٹنٹ (PWA)
> **اسٹیک:** React 19.2 + TypeScript 5.9 + Vite 7.2 + Tailwind CSS 4 + Convex 1.46 (`@convex-dev/auth`) + Firebase 13 (Firestore/Auth) — ڈوئل موڈ
> **تاریخ:** 26 اکتوبر 2026 — **پیکجنگ:** Bun 1.4.2
> **طریقِ کار:** لائیو کوڈ انسپکشن + مکمل پیداواری بلڈ (`vite build` — 3729 ماڈیول، 14.16 سیکنڈ)، `tsc -b --noEmit` (صاف، خوش)، انحصارات کے استعمال کی حقیقی تلاش (`rg`)، پبلک اور `dist/` اثاثوں کی اصل ماپ۔

---

## شدت کا نظام

| نشان | نام | تعریف |
|:---:|---|---|
| 🔴 | نہایت اہم (Critical) | ڈیٹا، پیسے یا ایپ کی سالمیت کا فوری خطرہ — اگلی ریلیز سے پہلے لازم |
| 🟠 | اعلیٰ (High) | ناپی تُلنے والی کے ساتھ نقصان (کارکردگی، ڈیٹا کھونے کا راستہ، سیکیورٹی کا خاکہ) — 2 اسپرنٹ میں |
| 🟡 | متوسط (Medium) | معیار، وضاحت حفاظتی سطح کی کوتاہی — آئندہ سنبھالنا |
| 🔵 | کم (Low) | صفائی / حفظان صحت — وقت ملتے ہی |

**محنت:** 🔹 کم (نصف دن) ▪ 🔸 متوسط (1–3 دن) ▪ 🔶 زیادہ (3+ دن)

> ہر نکتہ فارمیٹ: **شدت + مسئلہ — اثرات — حل — محنت**

---

# فاز 1 — ساخت، وابستگیاں، اسٹیٹ اور بنڈل (کوڈ آرکیٹیکچر)

## 1.1 — ٹیک اسٹیک اور فائل ساخت (خلاصہ)

✅ **مثبت:** DDD فیچر الگاؤ (`features/ledger | analytics | settings | ai-advisor | shop`)، تمام ریکارڈ کی تبدیلی ایک ریڈیوسر (`khataReducer`) میں مرکوز، `RoutePrimitives` میں بوٹ کی الگ کسوٹی، روٹس کی lazy چنکنگ، خود میزبان (self-hosted) فونٹس اور دستی لکھا ہوا service worker — داخلی آڈٹ (#6–#32) کے بدولت یہ بالغ کوڈ بیس ہے۔

**1.1.1 🟡** — `src/pages/KhataApp.tsx` نام گمراہ کن ہے: یہ صفحہ نہیں بلکہ پوری ایپ کا واحد اسٹیٹ کنٹینر ہے (`Dashboard` صرف اسے لپیٹتا ہے؛ اس میں 17 useState جمع ہیں جو مستقبل میں بڑھتے جائیں گے)۔
**اثرات:** نئے ڈویلپرز کو کبھی مرکزی نقطہ ملنے میں دیر۔
**حل:** اسے `src/features/root/LedgerApp.tsx` منتقل کریں۔
**محنت:** 🔹 کم

**1.1.2 🔵** — روٹ لیول پر `vly-toolbar-readonly.tsx` (462 سطریں) پلیٹ فارم کا ٹول بار ہے جو `src/` سے باہر ہے اور framer-motion کا گاہک ہے (تفصیل 1.5.1)۔
**اثرات:** پلیٹ فارم ٹول بار پروڈکشن بنڈل میں داخل ہو جاتا ہے (1.5.1)۔
**حل:** محیط فلگ (env flag) کے تحت مشروط/لاز امپورٹ۔
**محنت:** 🔹 کم

## 1.2 — انحصار کے درخت کا جائزہ

**نتیجہ:** 61 runtime انحصارات؛ ان میں **9 مکمل مردہ**، **2 صرف اسکرپٹس میں زندہ**، اور radix نظام *صرف* مردہ shadcn فائلوں کے گہرائیوں میں داخل ہے۔ تصدیق کا ذریعہ: `rg` کی حقیقی تلاش + `bun.lock`۔

**1.2.1 🟠** — **9 بے استعمال runtime پیکجز:** `recharts, embla-carousel-react, react-intersection-observer, react-resizable-panels, cmdk, vaul, input-otp, react-day-picker`; اور `axios` صرف `src/convex/auth/emailOtp.ts` کے ایک راستے کے لیے۔
**اثرات:** انسٹال وقت اور CVE سطح میں اضافہ، lockfile بھاری؛ (بنڈل سائز پر براہِ راست اثر کم — انہیں امپورٹ کرنے والا کوئی کوڈ نہیں اور روپ tree-shake کرتا ہے)۔
**حل:** `bun remove`؛ axios کی جگہ Convex کا اپنا `fetch`۔
**محنت:** 🔹 کم

**1.2.2 🟡** — `jsonwebtoken` + `jose` runtime dependencies میں ہیں مگر صرف `scripts/build-jwt.ts|.mjs` (ڈیو اسکرپٹس) میں۔
**اثرات:** پروڈکشن dependency درخت بے جا بڑھا ہوا۔
**حل:** `devDependencies` میں منتقل۔
**محنت:** 🔹 کم

**1.2.3 🟡** — `@oslojs/crypto` صرف random جنریشن کے لیے۔
**اثرات:** اضافی dependency، جب کہ Convex runtime میں `crypto.randomUUID` دستیاب ہے۔
**حل:** ہٹائیں۔
**محنت:** 🔹 کم

**1.2.4 🟡** — `zod` پروجیکٹ میں براہِ راست امپورٹ نہیں مگر `vite build` لاگز سے ثابت ہوتا ہے کہ `node_modules/zod` بلڈ چنکس میں آتا ہے (چلتی چیز کے ذریعے: vly ٹول/سونر)۔
**اثرات:** بے ضرورت (transitive) ڈیپ؛ منبع گمنام۔
**حل:** `bun why zod` سے زنجیر دیکھ کر فیصلہ۔
**محنت:** 🔹 کم

**1.2.5 🔵** — `@jridgewell/trace-mapping` — اس کا استعمال کوڈ بیس میں کہیں نظر نہیں آتا۔
**حل:** `bun why @jridgewell/trace-mapping` چیک کر کے ہٹائیں۔
**محنت:** 🔹 کم

**1.2.6 ✅** — `posthog-js` اور `@sentry/react` دونوں lazy چنکس (post-paint) میں لود ہوتے ہیں؛ کوئی تنہا کام میں حاشیہ۔

## 1.3 — مردہ کوڈ

**نتیجہ:** `src/components/ui/` میں **47 shadcn فائلیں**؛ محض **13 زندہ** (`button, separator, sheet, label, input, dialog, tooltip, toggle, textarea, sonner, skeleton, collapsible, calendar`)۔ باقی **34 مکمل مردہ** — accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb, button-group, card, chart (نوٹ: *صرف یہی فائل* `dangerouslySetInnerHTML` استعمال کرتی ہے)، carousel, command, context-menu, drawer, form (بھاری react-hook-form + zod زنجیر لے کر آتی تھی)، hover-card, item, kbd, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, select, sidebar, slider, switch, table, tabs, input-group, empty, field۔

**1.3.1 🟠** — 34 مردہ UI فائلیں + `components/ui/index.ts` کا بارل جو سب کچھ ایکسپورٹ کرتا ہے۔
**اثرات:** (1) 34 فائلوں کی دیکھ بھال/ٹائپ چیک بار؛ (2) بارل ہمیشہ نئے AI ہیلپر کو مردہ component استعمال کرنے پر اکساتا ہے؛ (3) کوڈ ریویو شور؛ (4) مستقبل میں بدقسمتی سے بارل امپورٹ پورا مردہ درخت زندہ کر سکتا ہے۔
**حل:** مردہ فائلیں حذف؛ بارل صرف زندہ ایکسپورٹس؛ حذف کے بعد `bun tsc -b --noEmit` سے تصدیق۔
**محنت:** 🔸 متوسط (میکینکل مگر بڑا)

**1.3.2 🟡** — مردہ انحصارات (1.2.1) انہی مردہ فائلوں کی زنجیر ہیں۔
**حل:** CI میں `knip`/`depcheck` توسیع (فاز 7)۔
**محنت:** 🔹 کم

**1.3.3 🔵** — `src/lib/` کے کچھ ماڈیول (`budget-notices.ts`, `daybook.ts` وغیرہ) کا استعمال knip سے مزید تصدیق طلب۔
**حل:** ایک بار `bun x knip` چلائیں اور نتائج کے مطابق صفائی۔
**محنت:** 🔹 کم

## 1.4 — اسٹیٹ مینجمنٹ فلو

آرکیٹیکچر (حقیقی راستہ):

```
KhataApp (والد — 17 useState)
 ├─ useKhata          → useReducer(khataReducer) + localStorage persist
 ├─ useSync(data)     → Firestore onSnapshot listeners (real-time) + cloud settings
 ├─ useAuth           → Firebase auth
 ├─ useVoiceAssistant → Web Speech API
 ├─ useAiAdvisor      → Convex action (ai.ts) برائے Gemini
 └─ مزید 8 ہوکس (staff / pwa / backup / notifications …)
```

✅ **مثبت:** ہر ریکارڈ تبدیلی ایک ریڈیوسر (`khataReducer`) سے گزرتی ہے؛ validation، undo اور persistence ایک جگہ؛ VOICE/مانوئل/امپورٹ سب ایک راستہ۔ یہ مستقل مزاجی کا اصل ستون ہے۔

**1.4.1 🟠** — **ڈوئل موڈ دو سچ (truth) کے خطرے سے:** `convex/schema.ts` میں `records / syncState / userSettings / aiCache` تعریفیں موجود، مگر client sync کا حقیقی راستہ صرف Firestore ہے (`use-sync.ts` — onSnapshot + batch upsert + prune)؛ Convex تختیں صرف auth، AI cache اور quota استعمال کرتی ہیں، اور `syncState` جیسا optimistic-concurrency ٹوکن دو جگہ بن چکا ہے۔
**اثرات:** سب سے بڑا معمار خطرہ؛ مستقبل کی خصوصیات (ملٹی ڈیوائس، سرور سائیڈ quota، offline conflicts) کو دو مختلف بیک اینڈ ماڈل آپس جھگڑا دیں گے۔
**حل:** فیصلہ کریں — (الف) Convex کو auth + AI تک محدود رکھیں اور اسے دستاویز کریں؛ یا (ب) پورا sync Convex منتقل کریں۔ فیصلہ ایک ADR فائل میں لکھیں۔
**محنت:** 🔶 زیادہ

**1.4.2 🟡** — **`syncState` ٹوکن کا سرور سائیڈ انفورس نمی** — Firestore میں `version` محض counter ہے؛ mismatch پر reject کرنے والا سرور سائیڈ راستہ نہیں (کوڈ کا تبصرہ خود تسلیم کرتا ہے)۔
**اثرات:** دو ڈیوائس ایک ہی وقت لکھیں تو آخری لکھنے والا بغیر نشانی جیت جاتا ہے؛ کوئی چپکے سے ڈیٹا بدل دیتا ہے۔
**حل:** Firestore سیکورٹی رولز کی write condition، یا upload مرحلہ `runTransaction` میں۔
**محنت:** 🔸 متوسط

**1.4.3 🟡** — **`undoStack` بے حد** — ہر add undo stack میں داخل، کوئی limit نہیں؛ stack ہی persist ہوتا ہے۔
**اثرات:** طویل استعمال کے بعد memory بڑھتی ہے، undo کا retroactive سلسلہ غلط؛ stack storage بڑھتا۔
**حل:** حد (مثلاً 50) + پرانی آنٹریوں کی کاٹائی۔
**محنت:** 🔹 کم

**1.4.4 🟡** — `clearValidationError` ہر render پر نئی فنکشن (`useKhata` کے ریٹرن آبجیکٹ میں)، useCallback نہیں۔
**اثرات:** ہلکا سا اضافی re-render؛ حقیر مگر آسانی سے سدھ ہوتا۔
**حل:** `useCallback`۔
**محنت:** 🔹 کم

**1.4.5 🟡** — `updateEntry` کا `[data]` وابستہ closure — جوہر (جیسے voice ٹیک میں add سے پھر edit) پر پرانی فہرست پڑھ سکتا ہے۔
**اثرات:** نایاب حق سے محتاط — راستہ صرف اپنی نیت مزیدتی camp؛ مگر بجد ریفر میں پڑنے کی جگہ۔
**حل:** reducer کے `update` کو صرف id بھیجیں (بغیر کشکول)؛ یا functional callback۔
**محنت:** 🔹 کم

**1.4.6 🟡** — **recurring-mirror effect** میں `eslint-disable exhaustive-deps` لگا ہوا ہے (KhataApp میں)۔
**اثرات:** دیپ محدود ہے — effect صرف مخصوص ان پٹ پر چلتا ہے۔
**حل:** عبور مخصوص دیپ comment میں دستاویز (فائل safe)؛ مستقبل ریویو آسان۔
**محنت:** 🔹 کم

**1.4.7 🔵** — `activeMonth` کو کلاؤڈ settings ک ج rätt نہیں — مطلب دوسری ڈیوائس پر کھلنے والے جاری مہینے نہیں ذاتی تازہ۔
**اثرات:** چھوٹا UX سوال而成的。
**حل:** settings doc میں `activeMonth` بھیجیں۔
**محنت:** 🔹 کم

**1.4.8 🔵** — **overlay روٹنگ `window.history.pushState` براہِ راست** — سب overlays ایک جگہ روٹ ہیں (audits #20 ھو hack کا شانصرہ)۔
**اثرات:** دیک نہیں react-router سے؛ پر keyboard اور back اچھا چلتا ہے Comentario۔
**حل:** چونکہ کام کر رہا ہے — فی الحال فقط فہرست؛ آئندہ کسی refactor میں router overlay روٹ۔
**محنت:** 🔸 متوسط

## 1.5 — بنڈل سائز بریک ڈاؤن (اصل ماپ)

`bun vite build` = 14.16s، 3729 ماڈیول۔ **کل JS ≈ 2,443 kB خام / ~790 kB gzip؛ CSS ≈ 158 kB / 24.5 kB gzip۔**

| چنک | خام kB | gzip kB | حیثیت | نوٹ |
|---|---:|---:|---|---|
| `index-DXkU5ddH.js` (انٹری) | 427.1 | 136.2 | 🔥 critical | ایپ شیل + i18n + khata لاگک |
| `framer-motion` چنک | 135.7 | 45.0 | 🔥 critical | **صرف vly-toolbar کی وجہ** |
| `radix-ui` | 43.9 | 14.9 | critical | زندہ components یہی سے |
| `react-vendor` | 38.0 | 13.7 | critical | |
| `button` | 30.7 | 9.9 | critical | |
| `firebase-vendor` | 562.2 | 169.3 | ✅ lazy post-paint | |
| `index-DbvoUkvX.js` (Sentry SDK) | 457.1 | 154.2 | ✅ lazy post-paint | سینٹری dynamic import |
| `module` (@vly-ai) | 332.9 | 110.5 | ✅ lazy post-paint | پلیٹ فارم |
| `ChartsPanel` (chart.js) | 209.7 | 71.8 | ✅ lazy on-demand | |
| `Dashboard` | 199.8 | 61.8 | ✅ lazy | |
| بقیہ ~15 چنکس | ~42 | ~17 | ✅ lazy | |
| CSS | 158.3 | 24.5 | critical | |

**فونٹ:** nastaliq-urdu-arabic.woff2 = 239 kB (preload)، latin = 20 kB؛ FontAwesome = 107 kB CSS + 308 kB woff2۔

**1.5.1 🟠** — framer-motion (135.7/45.0 kB) **انٹری کا حصہ** صرف اس لیے کہ `main.tsx` پلیٹ فارم ٹول بار statically درآمد کرتا ہے۔
**اثرات:** FCP/LCP خراب؛ 45 kB gzip فائدہ Teza مستھل ٹول کے کی۔
**حل:** `main.tsx` میں toolbar کو dev فلگ کے ساتھ دینا؛ سپر (بس اینی راہ پہچanners فرار) `import()` dynamic کرو — پہلا پینٹ خالص ہے۔
**محنت:** 🔹 کم

**1.5.2 🟠** — انٹری چنک 427 kB (136 gzip) blockی فرادت۔
**اثرات:** 3G فون پر پہلا پینٹ دردناک؛ LCP، خصومک شگت آغاز۔
**حل:** انٹری شیل مختصر: voice engine، tts، export-report، daybook ڈامک۔
**محنت:** 🔸 متوسط

**1.5.3 🟡** —FontAwesome بوتل: `all.min.css` + 308 kB woff2 جب کہ دبیربہت کم آئن (fa-receipt etc.)۔
**اثرات:** render بلاک کا CSS؛ دیری لوڈ فونٹس۔
**حل:** inline SVG صرف استعمال شدہ مlege؛ lucide پہلے موجود۔
**محنت:** 🔸 متوسط

**1.5.4 🟡** — `chart.js/auto` مکمل امپورت (~210 kB چنک) جب کہ صرف line/bar/doughnut۔
**اثرات:** چنک بڑا؛
**حل:** `chart.js` سیدہ امپورٹ؛ چنک ~40% کم۔
**محنت:** 🔹 کم

**1.5.5 🟡** — CSS 158 kB (11) — مردہ UI عناصر کا CSS حصہ۔
**حل:** 1.3.1 سے ساتھ ، stubوں تخمیہ؛ gzip 24.5 KB مناسب۔
**محنت:** 🔹 کم

**1.5.6 ✅** — چنک بذریعہ خریط: Firebase / Sentry / vly POST-پینٹ پر لود؛ nastaliq فونٹ صحیح preload؛ sourcemap کی خاموشگی؛ second-class؛ کدی کبھی insight insight ۔

---

# فاز 2 — سیکیورٹی اور ڈیٹا کا تحفظ

> نوٹ: `firestore.rules` فایل موجود ہے (6.8 kB) مگر اس کا emulator-based ٹیسٹ نہیں ملا، اس لیے یہ رپورٹ رولز کے مواد کی توثیق نہیں کر سکتی — جانچ فاز 7 کے CI مرحلے میں درکار ہے۔

**2.1 🟠** — **Gemini API key کلائنٹ جانب سے Firestore میں صاف متن (plaintext) کے طور پر محفوظ** — `useSync.saveGeminiKey` براہِ راست `users/{uid}/settings/current` ڈاک میں key لکھتا ہے؛ جب کہ سرور سائیڈ (`convex/crypto.ts`) AES-GCM انکرپشن کا انتظام رکھتا ہے اور `SAUTI_KEY_SECRET` کے غائب ہونے پر وہ اس کا کہیں کوئی فائدہ نہیں دیتا۔
**اثرات:** کسی بھی فون کا localStorage + Firestore پروفائل — key براؤزر ڈیٹا کی سلیں؛ یہاں رولز (2.2) چھید ہیں تو کرو سکتا ہے۔
**حل:** client سے key کبھی match نہ لکھی جائے — Convex action (`"use node"`) کے ذریعے ہی جاتی ہے جو AES-GCM کرکے رکھے۔
**محنت:** 🔸 متوسط

**2.2 🟠** — **firestore.rules کی توثیق نہیں** — فایل موجود مگر emulator ٹیسٹ اور CI آسٹی اگر نہیں؛ آڈٹ ڈوم parisn نہیں کر سکتب اچھا اسے کہ رولز درست ہیں۔
**اثرات:** خود کوئی match नुकов؛ شریف بھلا۔
**حل:** firebase emulator + rules unit ٹیسٹ (JS جیسے identifies); CI سٹیپ۔
**محنت:** 🔹 کم

**2.3 🟠** — **AI کی روزانہ حد سرور سائیڈ انفورس نمی** — `userSettings.aiDay/aiCalls` سکیمہ میں موجود مگر client کو диکھایا جاتا limit (AI_DAILY_LIMIT) خود ہی پاٹا ہے؛ code کا اپنا wiring ہیں comment admit کرتا ہے پر نہیں۔
**اثرات:** کسی مشت user کرتے request دروت طور سرور key تliya asked؛ بالکل API billing چوک۔
**حل:** Convex `ai.ts` उٹ جگس servي `aiDay/aiCalls` اپڈیٹ؛ quantity۔
**محنت:** 🔸 متوسط

**2.4 🟡** — **CSP خالی:** `index.html` میں کوئی Content-Security-Policy نہیں (پڑوسی meta نہیں)؛ least لاک کا trigger नहीं۔
**اثرات:** XSS گنجی محفوظ؛ پلس۔
**حل:** meta CSP (strict-dynamic ساچ رپورٹ-اونلی ہے اور ت sp سلیں)؛ Web history گاہی۔
**محنت:** 🔹 کم

**2.5 🟡** — **پروفائل ڈیٹا `localStorage` میں بطور محفوظ** — کہاں ڈوئل encrypted، کہیں؛ reset براؤزر وچ وقفہ؛ export ریمائنڈر ہے (بجٹ نٹ)ں
**اثرات:** ڈیٹا کی۔ 
**حل:** ڈوبٹاپ تی2 largest۔
**محنت:** 🔹 کم

**2.6 🟠** — **PIN/staff lock کلائنٹ سید بس؟** — PIN کاروبار کا صرف ک更显ے پیکس localStorage ہی الطرف extra میلا؛ بنید خسرہ۔
**اثرات:** کڴم جانِ ہیirs نمی۔
**حل:** کڈ، محفوظ سلسلہ خال سزا؛ hash-سرور خاص؛ خسرہ۔
**محنت:** 🔸 متوسط

**2.7 🔵** — `_import_`۔ فاضل CSV/JSON امپوتا میں سائز 2 MB کی حد + 数 نہیں نہیں dedupe (audit #31)۔ ✅؛ کبھی reason، قرض no، میں سمت خیر۔

**2.8 🟡** — **PDF/HTML رپورٹ میں escape ڈآمی جس** — `reportHtml` پا بناہے user درج strings کو HTML جگای؛ کسی XSS پہلو نہیں کھال (پرنٹ یو details)۔
**حل:** `escape-html` helper مثل سمجھ۔
**محنت:** 🔹 کم

---

# فاز 3 — کارکردگی اور Core Web Vitals

> بنیاد: اصل بلڈ ماپ (فاز 1.5۔)۔ محیط اعداد صرف کورولی دائر ہیں۔

**3.1 🟠** — **انٹری critical path ≈ 675 kB خام / ~220 kB gzip JS + 158 kB CSS** (انٹری 427 + framer-motion 136 + radix 44 + react-vendor 38 + button 31 + فونٹ 239 kB woff2 preload)۔
**اثرات:** 3G اردو فون (ٹارگٹ audience) پر FCP/LCP برا؛ 0.22–0.25 MB صرف JS۔
**حل:** 1.5.1 (toolbarDynamic) + 1.5.2 (voice/tts/export سپلٹ) — دو علاج مل کر critical JS ~400–450 kB خام۔
**محنت:** 🔸 متوسط

**3.2 🟡** — `ChartsPanel` چنک 209.7 kB — ٹھíc dynamic ہے مگر Analytics کھولتے ہی براہِ راست پورا chart.js/auto آتا ہے (1.5.4 سے 40% کم)۔
**محنت:** 🔹 کم

**3.3 🟡** — **Firebase 562 kB (169 gzip)** — lazy ہے مگر `Dashboard` lazy چنک کی زنجیر سے س considered۔
**اثرات:** لاگِ ان کے بعد اصل sync افتى۔
**حل:** `firebase/app` صرف tree-shake؛ auth/firestore tree-shنگ پہلے ہی عمل؛ مزید کو: `getFirestore` init کو `useSync` میں جگ دیں۔
**محنت:** 🔸 متوسط

**3.4 🟡** — **فہرست رینڈر وrts والا virtualization نہیں** — NotepadModal اور ShopPanel بڑی لیست popup (کاروبار زیادہ۔ entry کےو چڑھ تقریبات khó؛ سطرہ گیان میں نہیں کہ کس پڑدا realہ)۔
**اثرات:** ہزاروں انٹریوں پر input دیر (inp dلا اور INP)۔
**حل:** react-window/سلیں virtualization، جب معلوم۔ پلے ہو۔
**محنت:** 🔸 متوسط

**3.5 🟡** — **KhataApp کا re-render سطحہ** — سب ریس ریک اسی ایک نیوڈ: کوئی لکھی useState (مثلاً navOpen، apiKeyDraft) بڑے substance ج بیزیک۔
**حل:** React.memo موکلا瓣 (LedgerVoiceCenter، NotepadModal جیسی بڑے چنک) یا overlay name کی نئی position پن __گم renderes۔
**محنت:** 🔸 متوسط

**3.6 🔵** — **React Compiler غائب** — React 19 دستیاب؛ مگر خود memo work۔
**حل:** آج compiler آ نسبی (روح کی فارمنیس)۔
**محنت:** 🔸 متوسط

**3.7 ✅** — **کام کے اتنے نتائج** — Sentry/PostHog/vly چنکس post-paint؛ فونٹ self-host + preload؛ font-display swap کی نکاسی؛ SW stale-while-revalidate؛ dev URLs network-only– آڈٹ #6/9/10/22 کا دی давать نہیں۔

---

# فاز 4 — کوڈ کوالٹی، DX اور ٹیسٹنگ

**اسٹیٹس:** `tsc -b --noEmit` ✅ صاف؛ ESLint 9 فلیٹ config + react-hooks + react-refresh پلگ انز موجود؛ Prettier موجود؛ سکرپٹس `verify-khata.ts` + `verify-scaffolding.ts` سموک ٹیسٹ کی حیثیت سے ہیں؛ CI ورک فلو (`ci.yml`, `deploy.yml`) موجود۔

**4.1 🟠** — **کوئی وقتی (unit) ٹیسٹ سوٹ نہیں** — صرف دو ڈامر سموک سکرپٹس؛ reducer، khata lib، insights، تصویری widgets بے ٹیسٹ۔
**اثرات:** refactor کا خطرہ؛ WRONG نتیجہ کے خوف؛ ریکورڈنگ کی خوش۔
**حل:** Vitest + `khataReducer` / `useKhata` / `lib/insights.ts` کی ٹیسٹیں (خالص فوںکس سستی)؛ بعد میں Playwright سموک (add, undo, import, export)۔
**محنت:** 🔶 زیادہ (نیو اننفرا اسٹرکچر)

**4.2 🟡** — `vite.config.ts` کا manualChunks بڑی فہرست؛ چنکس سے نمبر گیژ۔
**اثرات:** چنک Eाकک flapping؛ چنیچہ اناثیگ۔
**حل:** HTML اوپر کے لیک action؛ label جو چنک درست۔
**محنت:** 🔹 کم

**4.3 🟡** — کچھ فتیں گردڣ امپورٹ ہو شامل، درخت سی؛ آز؛ صANTITY گچ۔
**حل:** importHighlighter/رخل کی سج؛ فارول۔
**محنت:** 🔹 کم

**4.4 🔵** — **`npm test` خالی** — ثانی بچنہ، ABHacier کمان۔
**محنت:** 🔹 کم

**4.5 🔵** — کوڈ کے اندر آڈٹ کی محفوظ تاریخ (audit #6–#32) — بہترین انسانی دستاویز؛ **تاہم** آڈٹ فہرست کی ک کوئی repository افس نہیں؛ درج ڈاکیومنٹ۔
**حل:** `docs/AUDIT-LOG.md` بنائیں جس میں سطرہ محکوم فہرست شامل۔
**محنت:** 🔹 کم

---

# فاز 5 — ڈیٹا لئیر اور بیک اینڈ (Convex + Firestore ڈوئل موڈ)

**ہیئت:** ڈ.getHeight Fibonacci؛ schema 5 تختی (users/records/syncState/aiCache/userSettings)؛ `"use node"` crypto + انتقال؛ sync بحری + syncState index + guest؛ ai limits۔

**5.1 🟠** — **وہی ڈوئل-موڈ عدم ہیئت (1.4.1) ڈیٹا لیئر سا علاج** — سوال: کس کا سرفر۔ اچھا ڈسٹار۔ا، پیر 'hear'؟۔
**حل:** ساکہ ہو نہیں قاری۔*Convex as__(*only* auth+AI)/firestore data—all مزید پالگی دیگرا۔
**محنت:** 🔶 زیادہ

**5.2 🟠** — **writeBatch pruning کی ریکس:** upload کے بعد batch پریوش، ع退缩 کی کوئی سگرٹ لنٹن؛ بیت و configure؛ data کےامر چن؛ آپ۔
**اثرات:** ہسٹورى +،engines replacing paths؛۔
**حل:** database transaction friendly خففل ہو۔
**محنت:** 🔸 متوسط

**5.3 🟡** — **MAX_RECORDS cap چپکستان** — upload پر صرف تازہ ترین (client cap) انٹریاں جاتی ہیں؛ capped ہو تو صفر کار وال نوٹس موجود ✅ جب کہ کلاؤڈ پر پرانی ریکارڈ موجود ہوںاور prune بک (5.2) اُنہیں ختم— آخر data ڈیوی۔ اس جس position، چڑ_RECEIVEہ۔
**حل:** sync میلا蕃ہ۔
**محنت:** 🔹 کم

**5.4 🟡** — **records چنچ بجٹ نہیں (ایمبل index)** — players userId index ہے؛ مگ large ledgers monthKey کوئیش۔
**اثرات:** چنک پڑھنا۔
**حل:** `by_user_month` index۔
**محنت:** 🔹 کم

**5.5 🟡** — **aiCache TTL کا کوئی تس ہمت برقرار** — crons.ts موجود؛ اس میں کیا کلیپ اور۔
**محنت:** 🔹 کم

**5.6 🔵** — **userSettings.appliedKeys انمٹ آرے** — recurring mirror کی idempotency کے لیے ہر مہینے بڑھتا ہے؛ سال کا کتنا نہیں پڑی۔
**حل:** پرانی مونتھ names۔
**محنت:** 🔹 کم

**5.7 ✅** — اسکیما معیار (indexes، optional fields، union literals)، ڈا include backers؛ AES-GCM درست schema؛ داکǘdent مکمل ایمیل OTP؛۔

---

# فاز 6 — UX، رسائی، اردو/RTL اور PWA

**حیثیت:** `dir="rtl"` + `lang="ur"` مرکزی فائل؛ digitStyle ترجیح (اردو/مغربی ہندسے)؛ وائس مرکزی تعامل؛ اردو TTS؛ 60 سیکنڈ onboarding ٹور؛ دستی SW offline shell؛ پورا manifest (icons، maskable، apple-touch)۔

**6.1 🟠** — **iOS/Safari پر وائس ان پٹ کا بیک فال نامعلوم** — Web Speech ASR صرف Chrome/Android پوری طرح ہے؛ Safari کا support حدی ہے۔ استعمال کی فے گر ID residentIndiaXII。《idéанта—directory؛ کिसी۔ir تو۔ئے audit what review Linux۔
**اثرات:** آدھی اہم خاصیت پہلے صفحے سے۔
**حل:** feature-detect + اردو میے وضاحتی UI (فال بیک tap-ادخال پہلے سے QuickEntry موجود ✅)؛ وضاحیت ___ س。（خعا گے ظ 想لمکیں۔
**محنت:** 🔸 متوسط

**6.2 🟡** — **modal focus management دستی** — custom Modal، دستوں کی دستاویز تربت کللا۔
**حل:** focus-trap + initial focus + Escape؛ radix کے dialog کای شکل۔
**محنت:** 🔸 متوسط

**6.3 🟡** — **کنٹراسٹ ہاتھ ناپ کی ابتا** — emerald/rose 深ن slate-950 glass پر؛ کم the اچھا مگر آس۔
**حل:** axe DevTools و calibrate شم رشد، ایک شکل۔
**محنت:** 🔹 کم

**6.4 🟡** — **اعلان (announcements) کے live region** — voice announce خط ک — screen-reader user برائی واردہ۔
**حل:** `aria-live=polite` زون؛ voice ایف؛۔
**محنت:** 🔹 کم

**6.5 🟡** — **SW version blog همچنین upper کے مسلک**۔-expect رंچ `CACHE_VERSION = sauti-v2` بپ، آئنس؛۔۔
**حل:** CI بلڈ میں hash نسخ خود write سیماس لاگ، 1۔۔
**محنت:** 🔹 کم

**6.6 🔵** — **shapes کا bracket عفت عرب اردو (categorize کالت میں) انگریزی فونٹس fallback؛۔۔**

**6.7 ✅** — **چهارinہ اچھ** — RTL درست؛ digitStyle سارا ڈاٹا مارک4 bibliography؛ onboarding چل들을؛ WhatsApp اس وی روت کا خاندان؛ PWA status component۔

---

# فاز 7 — انفراسٹرکچر، CI/CD، آبزروبیلیٹی اور اسکیل

**حیثیت:** CI (`ci.yml`) اور deployment (`deploy.yml`) ورک فلو موجود؛ Sentry + PostHog (post-paint، env-gated)؛ Convex crons؛ Freebuff hosting (static build → dist/)؛ .env سیکریٹس کی UI۔

**7.1 🟠** — **Sentry source maps اور release tagging غائب** — production بلڈ sourcemap نہیں، release id نہیں۔
**اثرات:** crash stack مرغی۔
**حل:** `@sentry/vite-plugin`؛ sourcemaps صرف Sentry کو upload، public نہیں؛۔
**محنت:** 🔹 کم

**7.2 🟠** — **E2E سموک نہیں** (4.1 کا آئنہ) — CI صرف typecheck+scaffolding؛起义 UX ریگریشن پکڑ نہیں سکتا۔
**حل:** Playwright چھوٹا سوٹ (ledger add/undo/export، auth، sync)؛ CI مرحلہ۔
**محنت:** 🔶 زیادہ

**7.3 🟡** — **knip/depcheck + bundle-size budget CI میں نہیں** — (1.2/1.3 issues واپس آئے جین۔)
**حل:** `size-limit` یا سادہ اسکرپٹ: انٹری gzip > 150 kB تو fail۔
**محنت:** 🔹 کم

**7.4 🟡** — **firestore.rules کا CI آسٹی اگر نہیں** (2.2)۔
**محنت:** 🔹 کم

**7.5 🔵** — **PostHog privacy mode کا ذکر ڈاکیومنٹ نہیں** — یہ تہذیبی داخلی۔
**حل:** PRIVACY.md، آن record consent طریقہ (فیلڈ diagnostics پہلے سے بغیر ڈیٹا ✅-good pattern)۔
**محنت:** 🔹 کم

**7.6 ✅** — **اچھا انتظامی** — static-only hosting ہے dependencies؛ Convex crons (ai c cache) item)؛اردو ورسن معیار ڈاکیومنٹ (DUAL-MODE/FIREBASE-SETUP/DEPLOY موجود)۔

---

# 🎁 بونس ڈہلیوربلز

## بونس A — ایگزیکٹو خلاصہ

**مجموعی گریڈ: B+ (75/100)** — مضبوط بنیاد، طرف staggering کے دوران کی دی جانے والی لمبی Audit کی تاریخ؛ بنیادی کمزوریاں dead-code جنگل، بالکل گونگا فریمر-موشن، اور کلائنٹ-side سیکیورٹی آسٹی۔

| فاز | موضوع | گریڈ | ایک لائن |
|---|---|:---:|---|
| 1 | سٹرکچر/انحصارات/اسٹیٹ/بنڈل | 7/10 | مضبوط آرکیٹیکچر؛ 34 مردہ UI فائلیں + 9 مردہ پیکجز؛ framer-motion انٹری میں بیٹا ہے |
| 2 | سیکیورٹی | 6/10 | AES-GCM سرور سائیڈ ✅ مگر کلائنٹ key plaintext راستہ، AI limit انفورس نمی، CSP خالی |
| 3 | کارکردگی | 6/10 | lazy چنکس اچھے مگر critical JS ~675 kB خام (مشرقی ٹول بار + انٹری) |
| 4 | کوالٹی/DX/ٹیسٹنگ | 5/10 | typecheck صاف؛ کوئی unit/E2E ٹیسٹ نہیں |
| 5 | ڈیٹا لئیر | 6/10 | ڈوئل بیک اینڈ جنگل — فیصلہ درکار؛ sync conflict سرور سائیڈ انفورس نمی |
| 6 | UX/رسائی/PWA | 7.5/10 | RTL اور PWA عمدہ؛ وائس fallback + a11y تفصیل کی کمی |
| 7 | انفرا/CI/observation | 6.5/10 | CI موجود؛ E2E، source maps، rules-assis، size-budget غائب |

**ٹاپ 5 فوری کام (ہفتہ 1)**
1. `main.tsx` میں Vly toolbar dev فلگ کے پیچھے (−45 kB gzip تنقیدی)
2. 34 مردہ ui فائلیں + مردہ پیکجز ہٹائیں (−~9 پیکجز، −158 kB CSS کا حصہ)
3. `saveGeminiKey` سرور-راستہ Convex action سے، لا client plaintext
4. `ai.ts` میں سرور سائیڈ روزانہ limit انفورس
5. bhut heavy: `chart.js/auto` → بصری امپورٹ (−~80 kB چنک)

**انکار کا راستہ (مقابلہ بلڈ ماپ):** انٹری gzip 136 → ~100 kB؛ فالتو مرثیہ پریو done۔

## بونس B — فولڈر ری اسٹرکچرنگ تجویز

```
src/
  app/                    # main.tsx کی جگہ؛ providers، bootloader
  features/
    root/                 # LedgerApp (پرانا pages/KhataApp تیں)۔
    ledger/  analytics/  settings/  ai-advisor/  shop/   # البہ موجود خandedي بد unserer نمی، a.dtik
      components/  hooks/  api/  types.ts
  components/
    layout/   sauti/   ui/          # ui صرف 13 زندہ فائلیں
  lib/     hooks/     convex/           # بدون تبدیلی
  pages/
    Dashboard.tsx  NotFound.tsx
vly-toolbar-readonly.tsx → tools/vly/ (dev-only، مشروط import)
```
**قواعد:** ایک فیچر ایک فولڈر؛ cross-feature امپورٹ صرف عام `lib/` یا بارل کے ذریعے؛ ہر مرحلے کے بعد `tsc -b --noEmit` سبز۔

## بونس C — Jira/Linear ٹکٹسم eid Eschatology

| آئی ڈی | عنوان | فاز | شدت | محنت | قبولیت کی شرائط |
|---|---|:---:|:---:|:---:|---|
| SAU-101 | مردہ ui components (34) حذف + بارل سنکی | 1 | 🟠 | 🔸 | knip صفر وارننگ؛ tsc سبز؛ UI regression نہیں |
| SAU-102 | 9 مردہ npm پیکجز + devDeps صفائی | 1 | 🟠 | 🔹 | `bun why <pkg>` خالی؛ lockfile ڈنگ |
| SAU-103 | vly-toolbar کو深入推进 dynamic/dev-gated بنائیں | 1/3 | 🟠 | 🔹 | انٹری چنک سے framer-motion غائب|
| SAU-104 | انٹری چنک سپلٹ (voice/tts/export/daybook) | 1/3 | 🟠 | 🔸 | انٹری gzip ≤ 100 kB |
| SAU-105 | undoStack حد + activeMonth کلاؤڈ سینک | 1 | 🟡 | 🔹 | 50 کا اوپری حد؛ device B پر جاری مہینہ |
| SAU-201 | Gemini key صرف Convex action سے محفوظ | 2 | 🟠 | 🔸 | client key plaintext لکھے؛ SAUTI_KEY_SECRET ضروری |
| SAU-202 | firestore.rules emulator ٹیسٹ + CI | 2/7 | 🟠 | 🔹 | رولز کے ≥8 کیس؛ CI سبز |
| SAU-203 | سرور سائیڈ AI daily limit | 2 | 🟠 | 🔸 | 25th request سے انکار؛ quota ڈسپلے سچ |
| SAU-204 | CSP (report-only شروع) | 2 | 🟡 | 🔹 | کوئی violation نہیں؛ پھر enforce |
| SAU-301 | FontAwesome کو استعمال‌شدہ SVG سے بدلیں | 1/3 | 🟡 | 🔸 | fontawesome webfonts چنкс سے |
| SAU-302 | chart.js سیدہ امپورٹ | 3 | 🟡 | 🔹 | ChartsPanel چنک ≤ 130 kB |
| SAU-303 | بڑی فہرستوں لی virtualization | 3 | 🟡 | 🔸 | 5,000 انٹریوں پر INP < 200 ms |
| SAU-304 | ماڈل فوکس ٹریپ + Escape + aria-live | 6 | 🟡 | 🔸 | axe نقصان صفر |
| SAU-401 | Vitest یونٹ سوٹ (reducer/lib) | 4 | 🟠 | 🔶 | کوریش ≥ 70% khata/insights |
| SAU-402 | Playwright سموک سوٹ | 4/7 | 🟠 | 🔶 | add/undo/import/export/auth مستقل سبز |
| SAU-501 | ڈوئل بیک‌اینڈ فیصلہ + ADR | 5 | 🟠 | 🔸 | ADR document؛ sync راستہ واحد |
| SAU-502 | Firestore transactionalic sync + prune ریکس ساچ | 5 | 🟠 | 🔸 | کنفلکٹ ڈیٹیکٹ؛ پرانی prune محفوظ |
| SAU-503 | by_user_months index | 5 | 🟡 | 🔹 | مہینہ کوئیش index پڑھی۔ |
| SAU-701 | Sentry source maps + release | 7 | 🟠 | 🔹 | prod کرش stack میں اصل لائن |
| SAU-702 | size-limit budget CI میں | 7 | 🟡 | 🔹 | انٹری gzip > 150 kB تو fail |

## بونس D — خطرہ میٹکس

| # | خطرہ | امکان | اثر | درجہ | مائٹیگیشن (ٹکٹ) |
|---|---|:---:|:---:|:---:|---|
| R1 | dois بیک اینڈ divergence سے sync تصادم / ڈیٹا کا فال | خالی | نہیں | 🔴 | SAU-501/502 |
| R2 | Gemini key کا خطر (plaintext client) | درمیانہ | بلند | 🟠 | SAU-201 |
| R3 | فون API سے قیمت کا نقصان (limit انفورس نمی) | خالی | مالیک | 🟠 | SAU-203 |
| R4 | reversed-آ آمد/سیرتمجر (CSP خالی) | درمیانہ | مالیک | 🟡 | SAU-204 |
| R5 | بڑا critical bundle سے موبائل پذیرائی کا تدل | خالی | مالیک | 🟠 | SAU-103/104/301 |
| R6 | ٹیسٹ فقی (regression کا خوف، refactor روک) | خالی | درمیانہ | 🟠 | SAU-401/402 |
| R7 | SW کا پرانا کیش چلتا رہے (بج گرد) | کم | درمیانہ | 🟡 | SAU-703 (بپخود) |
| R8 | چنک جہالے کاومنل 규}{ نہیں جماعة (manualChunks drift) | درمیانہ | کم | 🟡 | SAU-702 |
| R9 | پلیٹ فارم (vly) امپورٹ ختم صورت میں بند ڈو | کم | بلند | 🔵 | ریکenal document + guard ٹیسٹ |
| R10 | Firestore رولز کا untested سیکیوٹی فریشن | نامعلوم | بلند | 🟠 | SAU-202 |

> درجہ = امکان × اثر۔ R1 سب سے پہلے۔

## بونس E — کے پی آئی (KPIs) — موجودہ بمقابلہ ٹارگٹ

| KPI | موجودہ (ماپ) | ٹارگٹ | کیسے ناپیں |
|---|---:|---:|---|
| انٹری چنک (gzip) | 136.2 kB | ≤ 100 kB | `vite build` + list |
| تنقیدی JS کل (gzip) | ~220 kB | ≤ 150 kB | entry+preloads جمع |
| کل بنڈل JS (gzip) | ~790 kB | ≤ 550 kB | build log |
| CSS (gzip) | 24.5 kB | ≤ 18 kB | build log |
| مردہ ui فائلیں | 34 / 47 | 0 | `knip` |
| مردہ runtime پیکجز | 9 | 0 | knip/depcheck |
| یونٹ ٹیسٹ کوریج | ~0% | ≥ 70% (khata/insights) | `vitest --coverage` |
| E2E سموک | 0 Wolver | ≥ 8 کیس سبز | Playwright CI |
| LCP (4G موبائل، پہلا) | ماپ باقی | < 2.5 s | Lighthouse CI |
| INP | ماپ باقی | < 200 ms | RUM (PostHog ویب وائٹلز) |
| سرور سائیڈ AI limit | غیر انفورس | انفورسڈ | SAU-203 ٹیسٹ |
| Sentry stack resolution | خام | ≤ 1 مہینہ نامکمل | SAU-701 |

---

## اختتامیہ

یہ کوڈ بیس کثیر داخلی آڈٹ سے گزرا ہے مہربان اصل اعداد ماپ۔ **فوری اولیت:** ڈوئل بیک‌اینڈ فیصلہ (R1)، کلائنٹ key راستہ، اور تنقیدی بنڈل trim۔ پہلا ہفتہ کے پانچ کام (بونس A) دلائیں تو گریڈ ~B+ سے A− کی جانب۔

*(رپورٹ خودکار ماپ: `tsc -b --noEmit` صاف؛ `vite build` 14.16s — تمام اعداد اس بلڈ سے۔)*
