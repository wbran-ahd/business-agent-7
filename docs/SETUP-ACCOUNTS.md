# اکاؤنٹ سیٹ اپ گائیڈ — صوتی بقیہ

یہ گائیڈ **آپ کے لیے** ہے۔ کوڈ تیار ہے؛ جب آپ نیچے دیے گئے 3 اکاؤنٹس بنا کر keys `.env.local` میں ڈال دیں، سب کچھ خود بخود کام کرنے لگے گا۔

**کل وقت:** تقریباً 30 منٹ · **خرچہ:** تینوں کے مفت پلان کافی ہیں (حدیں وقت کے ساتھ بدلتی ہیں — اپنے ڈیش بورڈ پر دیکھیں)

| سروس | کیوں | env variable | وقت |
|---|---|---|---|
| Sentry | ایپ crash ہو تو آپ کو پتہ چلے | `VITE_SENTRY_DSN` | 5 منٹ |
| PostHog | کون سی سہولت کتنی استعمال ہو رہی ہے | `VITE_POSTHOG_KEY` | 5 منٹ |
| Firebase App Check | کوئی آپ کی API آپ کے ایپ کے بغیر استعمال نہ کرے | `VITE_RECAPTCHA_SITE_KEY` | 15 منٹ |
| Test user | UI کی جانچ کے لیے ایک محفوظ اکاؤنٹ | — | 5 منٹ |

> ⚠️ **سب اختیاری ہیں۔** کوئی key نہ ہو تو ایپ بالکل ویسے ہی چلتی ہے — کوئی error نہیں، کوئی نیٹ ورک کال نہیں، کوئی رفتار کا فرق نہیں۔

---

## 0. Keys کہاں رکھیں (یہ پہلے پڑھیں)

1. پروجیکٹ کی جڑ میں `.env.local` نام کی فائل بنائیں (اگر نہیں ہے)۔ یہ فائل `.gitignore` میں پہلے سے شامل ہے — git میں کبھی نہیں جائے گی۔
2. `.env.example` میں **صرف نام** ہیں، ویلیوز نہیں۔ اسے کبھی نہ بدلیں۔
3. فائل میں ایک ایک لائن:

   ```bash
   VITE_SENTRY_DSN=https://...
   VITE_POSTHOG_KEY=phc_...
   VITE_POSTHOG_HOST=https://us.i.posthog.com
   VITE_RECAPTCHA_SITE_KEY=6L...
   ```

4. **ڈیو سَرور بند کر کے دوبارہ چلائیں** — Vite `.env.local` صرف شروع ہونے پر پڑھتا ہے:
   ```bash
   bun run dev
   ```
5. key کسی کو چیٹ میں، اسکرین شاٹ میں، یا WhatsApp پر نہ بھیجیں۔ اگر غلطی سے چلی جائے تو سروس کے ڈیش بورڈ سے **rotate/revoke** کریں۔

> `VITE_` والی ویلیوز براؤزر تک جاتی ہیں — یہ عوامی ہوتی ہیں، اسی لیے Sentry DSN اور PostHog project key اسی طرح بنائے گئے ہیں۔ یہ Firebase کی `apiKey` کی طرح "شناخت کنندہ" ہیں، "راز" نہیں۔ اصل راز (جیسے `SAUTI_KEY_SECRET`) کبھی `VITE_` کے ساتھ نہ رکھیں۔

---

## 1. Sentry — خرابی کی رپورٹ (5 منٹ)

**کیوں:** جب صارف کے فون پر ایپ کریش ہو یا کوئی error آئے، آپ کو stack trace اور فون کی قسم نظر آئے — بغیر صارف سے پوچھے۔

### قدم بہ قدم

1. https://sentry.io کھولیں → **Get Started** → Google یا email سے sign up۔
2. پہلی بار: organization name (مثلاً `sauti-baqaya`) → **Create Organization**۔
3. **Create Project**:
   - Platform: **React**
   - Alert frequency: **On every issue** (بعد میں بدل سکتے ہیں)
   - Project name: `sauti-baqaya`
4. **Create Project** دبائیں۔ اگلی سکرین پر **DSN** نظر آئے گا، شکل:
   ```
   https://abc123def456@o123456.ingest.sentry.io/7890123
   ```
   یہ کاپی کریں (بعد میں: Project → Settings → Client Keys (DSN))۔
5. `.env.local` میں:
   ```bash
   VITE_SENTRY_DSN=https://abc123def456@o123456.ingest.sentry.io/7890123
   ```
6. `bun run dev` دوبارہ چلائیں۔

### تصدیق

1. ایپ کھولیں → DevTools (F12) → **Network** → فلٹر میں `ingest` لکھیں۔ ایک درخواست `…ingest.sentry.io/api/…/envelope/` نظر آئے گی۔
2. Console میں یہ چلائیں (یہ جان بوجھ کر ایک error پھینکتا ہے):
   ```js
   setTimeout(() => { throw new Error("sauti-baqaya test"); }, 0);
   ```
3. 1–2 منٹ میں Sentry → **Issues** میں `sauti-baqaya test` نظر آئے گا۔

### جو ڈیٹا کبھی نہیں جائے گا

`src/lib/sentry.ts` میں `scrubSentryEvent` ہر event سے یہ فیلڈز **حذف** کرتا ہے:

- `description`, `detail`, `amount`, `entry` (لین دین کی تفصیل اور رقم)
- `user.email`, `user.username`, `user.ip_address`
- URL کا query string اور hash (`?q=...`, `#...`)
- breadcrumbs کے اندر موجود یہی فیلڈز

یعنی Sentry کو صرف یہ پتہ چلے گا کہ "کہاں crash ہوا"، یہ نہیں کہ "کس نے کتنے روپے کا چائے کا خرچہ لکھا"۔

---

## 2. PostHog — صارف کی نقل و حرکت (5 منٹ)

**کیوں:** یہ جاننے کے لیے کہ لوگ وائس انٹری استعمال کرتے ہیں یا ہاتھ سے لکھتے ہیں، اور ساتویں دن واپس آتے ہیں یا نہیں۔

### قدم بہ قدم

1. https://posthog.com کھولیں → **Get started** → sign up۔
   - **US** یا **EU** region چنیں — یہ بعد میں نہیں بدلتا۔ پاکستان کے لیے **US** عام طور پر تیز ہے۔
2. Project بنائیں: نام `sauti-baqaya`۔
3. **Project Settings** (یا Settings → Project) → **Project API Key** کاپی کریں۔ شکل: `phc_xxxxxxxxxxxxxxxx`۔
4. `.env.local` میں:
   ```bash
   VITE_POSTHOG_KEY=phc_xxxxxxxxxxxxxxxx
   # EU region چنا تھا تو:
   # VITE_POSTHOG_HOST=https://eu.i.posthog.com
   ```
5. `bun run dev` دوبارہ چلائیں۔

### تصدیق

1. DevTools → **Network** → `us.i.posthog.com` (یا `eu.i.posthog.com`) کی درخواستیں نظر آئیں۔
2. PostHog → **Activity** → **Live events** کھلا رکھیں۔

> ⚠️ **آج یہاں کوئی event نہیں آئے گا — یہ خرابی نہیں۔** SDK جڑ گیا ہے، مگر `track()` کو ابھی کسی سکرین نے نہیں بلایا۔ چھ events (`app_opened`, `signed_up`, `first_entry_created`, `voice_entry_used`, `ai_advice_tapped`, `day7_return`) `src/lib/analytics.ts` میں تیار ہیں؛ انہیں UI کے ساتھ جوڑنا **فیز 3** کا کام ہے، کیونکہ اس کے لیے یہ فیصلہ چاہیے کہ کون سی سکرین پر، کب، اور کیا رضامندی (consent) دکھانی ہے۔

### کیا نہیں بھیجا جائے گا

- `amount`, `detail`, `description`, `entry` — ہمیشہ حذف
- کوئی بھی nested object — صرف سادہ string/number/boolean جاتا ہے
- session recording — **بند** ہے (`disable_session_recording: true`)، کیونکہ کھاتے کی سکرین ریکارڈ کرنا صارف کی نجی باتوں کو ریکارڈ کرنا ہے
- autocapture — **بند**؛ صرف declared events
- نام، ای میل، فون — `identifyUser()` صرف Firebase `uid` بھیجتا ہے

---

## 3. Firebase App Check — API کی حفاظت (15 منٹ)

**کیوں:** آج کوئی بھی آپ کا Firebase project ID اور public config نکال کر آپ کے Firestore کو سیدھا استعمال کر سکتا ہے۔ App Check ہر درخواست کے ساتھ ایک ٹوکن بھیجتا ہے جو صرف آپ کے ڈومین پر چلنے والی ایپ بناسکتی ہے۔

> 🔴 **آج "Enforce" نہ چلائیں۔** پہلے ٹوکن بھیجنا شروع ہو، پھر کچھ دن Metrics دیکھیں، تب enforcement فیز 3 میں۔ جلدی enforce کرنے سے اصل صارفین کا ڈیٹا بند ہو جائے گا۔

### قدم بہ قدم

**3.1 — reCAPTCHA v3 key بنائیں**

1. https://www.google.com/recaptcha/admin/create کھولیں (اسی Google اکاؤنٹ سے جو Firebase کا ہے)۔
2. Label: `sauti-baqaya`
3. reCAPTCHA type: **Score based (v3)**
4. Domains میں شامل کریں:
   - `localhost` (ڈیولپمنٹ)
   - آپ کا اصل ڈومین، مثلاً `sauti-baqaya.example.com`
   - preview ڈومین صرف اس وقت جب آپ preview پر App Check آزمانا چاہیں (preview URL ہر بار بدلتا ہے)
5. شرائط قبول کریں → **Submit**۔
6. **Site key** (عوامی، `6L…`) اور **Secret key** (نجی) دونوں کاپی کریں۔

**3.2 — Firebase Console میں رجسٹر کریں**

1. https://console.firebase.google.com → اپنا project کھولیں۔
2. بائیں مینو → **App Check**۔
3. **Apps** ٹیب → اپنی **Web** ایپ → **Register**۔
4. Provider: **reCAPTCHA v3**
5. یہاں **Site key** اور **Secret key** دونوں ڈالیں (Secret صرف Console کے لیے ہے، کوڈ میں نہیں جاتی)۔
6. **Save**۔

**3.3 — کوڈ میں site key**

`.env.local` میں:

```bash
VITE_RECAPTCHA_SITE_KEY=6Lxxxxxxxxxxxxxxxxxxxxxxxx
```

`bun run dev` دوبارہ چلائیں۔

### تصدیق

1. DevTools → Console: `[App Check]` سے متعلق کوئی error نہ ہو۔ پہلی بار `firebase/app-check` لوڈ ہوگا اور reCAPTCHA کو ٹوکن مانگے گا۔
2. Firebase Console → App Check → **APIs** ٹیب → **Cloud Firestore** → **Requests** گراف میں کچھ درخواستیں "verified" نظر آئیں (enforcement بند ہونے پر بھی metrics بنتے ہیں)۔
3. مقامی ڈیولپمنٹ پر ٹوکن نہ بنے تو:
   - reCAPTCHA admin میں `localhost` شامل ہے؟ (v3 عام طور پر خود اجازت دیتا ہے)
   - `.env.local` بدلنے کے بعد ڈیو سَرور دوبارہ چلا؟
   - براؤزر کا ad-blocker reCAPTCHA روک رہا ہے؟

### نوٹ: مقامی ٹیسٹنگ

Firebase App Check ڈیولپمنٹ میں جعلی ٹوکن کے لیے ایک **debug token** دیتا ہے، مگر اس کے لیے `main.tsx` میں ایک لائن (`self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;`) init سے پہلے چاہیے۔ یہ **فیز 3** میں شامل ہوگا، فی الحال نہیں — آج key نہ ہونے سے App Check بالکل خاموش ہے۔

---

## 4. Test Access — ایکٹیویشن کوڈ (5 منٹ)

> ⚠️ **اپ ڈیٹ:** یہ سیکشن تاریخ ہے — ایکٹیویشن/ایڈمن سسٹم حذف ہو چکا ہے اور ایپ `/` پر سیدھی کھلتی ہے۔

**کیوں:** ڈیش بورڈ، کھاتہ، دکان اور رپورٹ کی سکرینز صرف ایکٹیویٹ شدہ ڈیوائس پر کھلتی ہیں۔

> ⚠️ **email/OTP/Google سائن اِن مکمل طور پر حذف ہو چکے ہیں۔** داخلہ صرف QR/ایکٹیویشن کوڈ سے ہے۔
> ایکٹیویشن سسٹم مراحل 3–6 میں بنتا ہے؛ تب تک `/dashboard` مقفل رہے گا۔

### طریقہ

1. Admin panel (`/admin`) میں لاگ اِن ہوں۔
2. **نیا کوڈ** بنائیں: plan، مدت، features، devices۔
3. QR اسکین کریں، یا کوڈ `/activate` پر درج کریں۔
4. Dashboard کھل جائے گا۔

### قاعدہ

- کوڈ کسی فائل، اسکرین شاٹ یا commit میں نہ رکھیں۔
- ٹیسٹ کوڈ الگ label سے بنائیں (مثلاً `TEST-1`) تاکہ اصل codes سے الگ رہے۔
- UI baseline کے شاٹس اسی ٹیسٹ کوڈ سے لیں۔

## 5. آخری چیک لسٹ

- [ ] `.env.local` میں چاروں ویلیوز (یا صرف وہ جو آپ چاہتے ہیں)
- [ ] `.env.local` git میں نہیں (`git status` میں نہیں دکھتا)
- [ ] `bun run dev` دوبارہ چلا
- [ ] Sentry: Network میں `ingest` درخواست، اور test error Issue میں آیا
- [ ] PostHog: Network میں `us.i.posthog.com`؛ Live events خالی (ابھی متوقع ہے)
- [ ] App Check: Console میں کوئی `[App Check] Initialisation failed`
- [ ] Firebase Console میں enforcement **بند**
- [ ] کوئی key چیٹ/اسکرین شاٹ/commit میں نہیں گئی

## 6. Keys آنے کے بعد میں کیا کروں گا

1. `.env.local` موجود ہونے کی تصدیق (ویلیوز نہیں پڑھوں گا، نہ پرنٹ کروں گا)
2. `bun run dev` → Network میں تینوں SDK کی درخواستیں
3. Sentry میں ایک جان بوجھ کر پیدا کردہ error بھیج کر تصدیق
4. App Check کے metrics میں verified requests
5. پھر **فیز 3**: events کو سکرینوں سے جوڑنا، Firestore rules سخت کرنا، App Check enforce کرنا

---

_آخری اپڈیٹ: فیز 0 (اکاؤنٹ اسکیفولڈنگ) — کوئی UI تبدیل نہیں ہوئی۔_
