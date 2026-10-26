# Firebase سیٹ اپ گائیڈ — صوتی بقیہ

> ⚠️ **اپ ڈیٹ:** ایکٹیویشن، لائسنسنگ، لاگ اِن اور ایڈمن پینل مکمل طور پر حذف ہو چکے ہیں۔
> ایپ `/` پر سیدھی کھاتی ہے اور صرف پیچھے پردہ **anonymous Firebase Auth** استعمال کرتی ہے
> تاکہ Firestore rules کام کرتی رہیں۔ `functions/`، Email/Password provider، admin UID،
> `/activate` اور `/admin` والے مراحل اب لاگو نہیں ہوتے۔

یہ گائیڈ **آپ کے لیے** ہے۔ ایجنٹ نے تمام config فائلیں تیار کر دی ہیں؛ نیچے دیے گئے کام **آپ اپنے کمپیوٹر پر** کریں گے۔

|                 |                                                                   |
| --------------- | ----------------------------------------------------------------- |
| **Project ID**  | `gen-lang-client-09792501-d8895`                                  |
| **Admin email** | `wbranahd@gmail.com`                                              |
| **Region**      | `asia-south1` (ممبئی — پاکستان کے لیے کم سے کم latency)           |
| **Runtime**     | Node.js **22**                                                    |
| **کل وقت**      | تقریباً 25 منٹ (پہلی deploy 10 منٹ اضافی)                         |
| **اخراج**       | Blaze plan؛ اس ایپ کے استعمال میں مفت حد کے اندر رہنے کا امکان ہے |

> ⚠️ **ایجنٹ deploy نہیں کرے گا** (آپ کا فیصلہ 4)۔ وہ صرف code، config اور یہ گائیڈ تیار کرتا ہے۔

---

## 0. پہلے یہ پڑھیں

### آپ کیا کریں گے، ایجنٹ کیا کرے گا

| کام                                                                | کون                            |
| ------------------------------------------------------------------ | ------------------------------ |
| Firebase Console: Blaze، providers، admin user، Firestore، Hosting | **آپ**                         |
| `firebase.json`، `.firebaserc`، `functions/`، rules، indexes       | ایجنٹ ✅ (ہو گیا)              |
| Functions کا اصل code                                              | ایجنٹ ✅ (مرحلہ 3 میں مکمل)    |
| `/activate` اور `/admin` سکرینیں                                   | ایجنٹ (مرحلہ 5–6)              |
| `firebase deploy`                                                  | **آپ**                         |
| Admin UID rules میں ڈالنا                                          | ایجنٹ ✅ (مرحلہ 3 میں ڈال دیا) |

### 4 چیزیں جو کبھی نہ کریں

1. **`firebase init` نہ چلائیں** — یہ موجودہ `firebase.json`، `.firebaserc` اور `functions/` کو اوور رائٹ کر دے گا۔ سب کچھ پہلے سے تیار ہے۔
2. **Service-account JSON کسی کو نہ بھیجیں** — وہ Firestore کے تمام rules بائی پاس کر سکتی ہے۔ یہ `.gitignore` میں blocked ہے۔
3. **`.env` یا کوئی key chat میں paste نہ کریں** — صرف UID بھیجیں (وہ راز نہیں، مگر عوامی جگہ پر بھی نہ لکھیں)۔
4. **پرانی Firestore database کو delete نہ کریں** — location بعد میں تبدیل نہیں ہو سکتی۔

---

## 1. Firebase Console کھولیں

1. https://console.firebase.google.com کھولیں۔
2. اوپر project selector سے **`gen-lang-client-09792501-d8895`** منتخب کریں۔
3. براہ راست لنک: `https://console.firebase.google.com/project/gen-lang-client-09792501-d8895/overview`

**تصدیق:** Overview صفحے پر project ID بالکل وہی نظر آئے جو اوپر جدول میں ہے۔

---

## 2. Blaze plan (لازمی)

Cloud Functions اور Secret Manager صرف Blaze پر چلتے ہیں۔

1. نیچے بائیں کونے میں **Upgrade** (یا ⚙️ **Project settings** → **Usage and billing**)۔
2. **Details & settings** → **Modify plan** → **Blaze** منتخب کریں۔
3. بلینگ اکاؤنٹ (کارڈ) شامل کریں — Google Cloud ہر مہینے کی پہلی استعمال پر چارج نہیں کرتا۔
4. **Purchase** / **Confirm**۔

### مفت حد (سانس لینے کی ضرورت نہیں)

| سروس            | مفت ماہانہ                                         |
| --------------- | -------------------------------------------------- |
| Cloud Functions | ~20 لاکھ کالز، 4 لاکھ GB-s، 2 لاکھ CPU-s           |
| Firestore       | 1 GiB storage، روزانہ 50,000 reads / 20,000 writes |
| Hosting         | 10 GB storage، روزانہ 360 MB transfer              |
| Secret Manager  | چند active versions مفت حد میں                     |

یہ ایپ (ایک دکان، مٹھی بھر صارفین) ان حدوں کے **بہت** نیچے رہے گی۔ البتہ Functions کی container images Artifact Registry میں تھوڑی جگہ لیتی ہیں — پہلے مہینے بل ضرور دیکھیں۔

### بجٹ الرٹ (2 منٹ — ضرور کریں)

1. https://console.cloud.google.com/billing/budgets کھولیں (وہی project منتخب)۔
2. **Create budget** → نام `sauti-monthly` → Amount: **$1**۔
3. Alerts: **50%، 90%، 100%** → email `wbranahd@gmail.com` → **Finish**۔

> ⚠️ بجٹ الرٹ **روکتا نہیں**، صرف خبر دیتا ہے۔ Hard cap نہیں لگایا جا سکتا، اس لیے alert ہی بہترین حفاظت ہے۔

**تصدیق:** Project settings → Usage and billing پر **Blaze** لکھا ہو۔

---

## 3. Authentication — دو providers

لنک: `https://console.firebase.google.com/project/gen-lang-client-09792501-d8895/authentication/providers`

### 3.1 Anonymous (پہلے سے ہے — صرف چیک کریں)

- **Anonymous** قطار میں **Enabled** لکھا ہونا چاہیے۔
- اگر Disabled ہے تو Enable → Save۔

> ہر صارف اسی anonymous identity سے داخل ہوتا ہے۔ یہی اس کا `uid` بنتا ہے۔

### 3.2 Email/Password (صرف admin کے لیے)

- **Email/Password** → **Enable** → **Save**۔
- **Email link (passwordless sign-in)** کو **Enable نہ کریں**۔

> ⚠️ اسے enable کرنے سے عام صارفین کو کوئی فرق نہیں پڑتا — ایپ میں کوئی signup/sign-in فارم نہیں ہے۔ یہ صرف `/admin/login` کے لیے ہے جو مرحلہ 6 میں بنے گا۔
>
> اصول یہ ہے: کوئی بھی email/password اکاؤنٹ بنا کر **admin نہیں بن سکتا**۔ Admin صرف وہ اکاؤنٹ ہے جس کا UID rules میں hardcode ہوگا۔

**تصدیق:** دونوں قطاروں پر سبز **Enabled**۔

---

## 4. Admin اکاؤنٹ بنائیں اور UID کاپی کریں

لنک: `https://console.firebase.google.com/project/gen-lang-client-09792501-d8895/authentication/users`

1. **Add user** دبائیں۔
2. **Email:** `wbranahd@gmail.com`
3. **Password:** کوئی مضبوط، منفرد پاس ورڈ (16+ حروف) — **پاس ورڈ مینیجر میں رکھیں**، کہیں لکھ کر نہ رکھیں، مجھے نہ بھیجیں۔
4. **Add user**۔
5. فہرست میں نئی قطار آئے گی۔ **UID** کالم میں 28 حروف کا سٹرنگ ہوگا، مثلاً `aB3dE9...`۔
6. UID کے ساتھ کاپی آئیکن دبائیں، یا قطار پر کلک کر کے تفصیل سے کاپی کریں۔

**مجھے یہ بھیجیں:** صرف **UID** (28 حروف، بغیر خالی جگہ)۔

> یہ UID مرحلہ 6 میں دو جگہوں پر جائے گا: `firestore.rules` میں `ADMIN_UID_PLACEHOLDER` کی جگہ، اور `/admin` کے UI gate میں۔
>
> UID کوئی راز نہیں (یہ صرف شناخت ہے)، مگر اسے عوامی جگہ پر نہ لکھیں۔

**تصدیق:** Users فہرست میں `wbranahd@gmail.com` نظر آئے، اور UID کالم خالی نہ ہو۔

> اگر آپ کا Google اکاؤنٹ 2-step verification کے بغیر ہے تو ابھی آن کریں — یہ admin اکاؤنٹ کی اصل حفاظت ہے۔

---

## 5. Firestore

لنک: `https://console.firebase.google.com/project/gen-lang-client-09792501-d8895/firestore`

### اگر database پہلے سے موجود ہے (زیادہ امکان)

1. **Database** صفحہ کھولیں۔
2. **Location** دیکھیں۔
   - `asia-south1` ہے → آگے بڑھیں ✅
   - کچھ اور ہے → **کچھ نہ کریں**، مجھے بتائیں۔ Location بعد میں تبدیل نہیں ہو سکتی؛ ہم اسی location کے ساتھ چلیں گے (فرق صرف latency کا ہے)۔

### اگر database موجود نہیں

1. **Create database**۔
2. Edition: **Standard**۔
3. Database ID: `(default)`۔
4. Location: **asia-south1** (Mumbai)۔
5. Mode: **Production mode** (rules بعد میں deploy ہوں گے؛ default-deny سب سے محفوظ ہے)۔
6. **Create**۔

> ⚠️ Location اور edition بعد میں **نہیں** بدل سکتے۔

**تصدیق:** Firestore → Data tab کھلے، اور اوپر location `asia-south1` دکھے۔

---

## 6. Hosting

لنک: `https://console.firebase.google.com/project/gen-lang-client-09792501-d8895/hosting`

1. اگر **Get started** نظر آئے تو دبائیں (wizard کے steps صرف تعارفی ہیں — CLI سے deploy ہوگا)۔
2. Default site ID `gen-lang-client-09792501-d8895` ہوگا۔
3. Custom domain ابھی **نہ** جوڑیں — پہلے `.web.app` URL پر سب کچھ چلنے دیں۔

**تصدیق:** Hosting صفحہ کھلے اور default site نظر آئے (abhi "Not deployed" لکھا ہوگا — یہ نارمل ہے)۔

---

## 7. تیار شدہ فائلیں (ایجنٹ کی طرف سے)

| فائل                      | کام                                                                          |
| ------------------------- | ---------------------------------------------------------------------------- |
| `firebase.json`           | Functions (Node 22)، Firestore rules/indexes، Hosting SPA rewrite، emulators |
| `.firebaserc`             | Default project                                                              |
| `functions/package.json`  | firebase-admin 14، firebase-functions 7، Node 22                             |
| `functions/tsconfig.json` | strict TypeScript → `lib/`                                                   |
| `functions/src/index.ts`  | scaffold (اصل فنکشنز مرحلہ 3)                                                |
| `functions/.env.example`  | صرف variable names                                                           |
| `firestore.rules`         | **merged** — پرانے ledger rules برقرار + نئی licensing collections           |
| `firestore.indexes.json`  | صرف نئی indexes                                                              |

### دو اہم تکنیکی فیصلے (آپ کے JSON سے معمولی فرق)

1. **`nodejs22` بجائے `nodejs20`** — Firebase CLI کے مطابق Node 20 کی decommission تاریخ **2026-10-30** ہے (چھ دن بعد)۔ Node 22 کم از کم **2028** تک چلے گا۔
2. **`firebase.json` میں `region` کلید نہیں** — Firebase اسے firebase.json میں قبول نہیں کرتا؛ region function کے code میں `setGlobalOptions({ region: "asia-south1" })` سے آئے گا (مرحلہ 3)۔
3. **`/api/**`rewrite نہیں** — ہم`https.onCall` استعمال کریں گے (آپ کی تجویز)، جس کے لیے rewrite کی ضرورت نہیں۔ صرف SPA fallback rewrite ہے۔

### Rules کا اصول

- پرانے rules (`users`، `records`، `settings`، `sync`) **ایک حرف نہیں بدلا**۔
- نئے: `codes`، `licenses`، `audit_log`، `rate_limits`، `admins` — سب client سے **write: false**۔
- `licenses/{uid}` صرف مالک پڑھ سکتا ہے؛ admin سب پڑھ سکتا ہے۔
- `ADMIN_UID_PLACEHOLDER` ابھی کسی سے match نہیں کرتا → **fail-closed**۔ UID ڈالنے تک admin panel band رہے گا، صارفین متاثر نہیں ہوں گے۔

---

## 8. اپنے کمپیوٹر پر CLI

### 8.1 Node.js

- Node.js **22 LTS** انسٹال کریں (https://nodejs.org)۔
  آپ کے پاس 24 ہو تو بھی chalega، مگر functions کا runtime 22 ہی رہے گا۔
- چیک: `node -v` → `v22.x` یا `v24.x`

### 8.2 Firebase CLI

```bash
npm install -g firebase-tools
firebase --version
```

### 8.3 Login

```bash
firebase login
```

براؤزر کھلے گا → **`wbranahd@gmail.com`** سے login → Allow۔

```bash
firebase projects:list
```

فہرست میں `gen-lang-client-09792501-d8895` نظر آنا چاہیے۔

### 8.4 Project منتخب کریں

```bash
cd path/to/sauti-baqaya
firebase use gen-lang-client-09792501-d8895
```

> `.firebaserc` پہلے سے موجود ہے، اس لیے `firebase use --add` کی ضرورت نہیں۔

---

## 9. Build اور Deploy

### 9.1 Pehli baar — dependencies

```bash
# پروجیکٹ کی جڑ میں
bun install

# functions کے لیے (Firebase npm استعمال کرتا ہے)
cd functions
npm ci
npm run build
cd ..
```

> `functions/package-lock.json` committed ہے، اس لیے `npm ci` عین وہی versions دے گا۔

### 9.2 Frontend build

```bash
bun run typecheck
bun run build
```

`dist/` بن جائے گا — Hosting یہی upload کرتا ہے۔

### 9.3 Deploy — مرحلہ وار (پہلی بار)

```bash
# 1) Rules پہلے — default-deny + licensing
firebase deploy --only firestore:rules

# 2) Indexes
firebase deploy --only firestore:indexes

# 3) Hosting
firebase deploy --only hosting
```

Functions کا deploy (یہ اب تیار ہے):

```bash
# یہ پہلے — ایک بار، صرف ایک بار (مرحلہ 12 دیکھیں)
firebase functions:secrets:set ACTIVATION_PEPPER

# پھر Functions
firebase deploy --only functions
```

پہلی Functions deploy پر CLI APIs enable کرنے کی اجازت مانگے گا (Cloud Build, Artifact Registry, Cloud Run, Eventarc) — **Yes**۔ اس میں 5–10 منٹ لگ سکتے ہیں۔

### 9.4 اگلی بار (ایک کمانڈ)

```bash
bun run build && firebase deploy
```

`firebase.json` کا `predeploy` functions کو خود build کرے گا۔

---

## 10. پوسٹ ڈیپلائے تصدیق

| #   | کیا دیکھیں                       | متوقع                                                |
| --- | -------------------------------- | ---------------------------------------------------- |
| 1   | Terminal میں Hosting URL         | `https://gen-lang-client-09792501-d8895.web.app`     |
| 2   | وہ URL کھولیں                    | Landing page render ہو                               |
| 3   | `/dashboard`                     | خالی/بلاک (بغیر activation) — یہ مرحلہ 5 تک نارمل ہے |
| 4   | `/admin`                         | ابھی 404 — مرحلہ 6 میں بنے گا                        |
| 5   | Console → Authentication → Users | ایک نیا **anonymous** user نمودار ہو                 |
| 6   | Console → Firestore → Rules      | merged rules نظر آئیں (`codes`، `licenses` شامل)     |
| 7   | Console → Firestore → Data       | `codes`/`licenses` خالی (مرحلہ 3 تک)                 |
| 8   | Console → Functions              | ابھی خالی (مرحلہ 3)                                  |
| 9   | DevTools → Console               | کوئی سرخ error نہ ہو                                 |

---

## 11. مسائل اور حل

| علامت                                         | وجہ                        | حل                                                                 |
| --------------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `Your project must be on the Blaze plan`      | Functions/secrets          | مرحلہ 2 کریں                                                       |
| `Missing or insufficient permissions` (users) | rules deploy نہیں ہوئے     | `firebase deploy --only firestore:rules`                           |
| `auth/operation-not-allowed` (admin login)    | Email/Password disabled    | مرحلہ 3.2                                                          |
| `The query requires an index`                 | index نہیں بنا             | پیغام کے لنک پر کلک، یا `firebase deploy --only firestore:indexes` |
| `CORS` error (callable)                       | region mismatch            | client میں `getFunctions(app, "asia-south1")`                      |
| `Node.js 20 ... decommissioned`               | runtime                    | ہم `nodejs22` استعمال کر رہے ہیں                                   |
| Hosting پر deep link 404                      | rewrite غائب               | `firebase.json` کا SPA rewrite چیک کریں                            |
| `firebase login` پر permission error          | پرانا token                | `firebase login --reauth`                                          |
| Admin panel "رسائی نہیں"                      | UID placeholder            | مرحلہ 6: UID rules میں ڈالیں                                       |
| `npm ci` fails in functions                   | lockfile mismatch          | `rm -rf node_modules package-lock.json && npm install`             |
| Blaze کے باوجود Functions deploy نہ ہو        | billing account incomplete | Cloud Console → Billing چیک کریں                                   |

---

## 12. مرحلہ 3 کے کام (Functions code تیار ہے — یہ مرتبہ سیٹ کریں)

Functions deploy سے پہلے ایک **secret** چاہیے:

```bash
firebase functions:secrets:set ACTIVATION_PEPPER
```

- ویلیو: 64 حروف کا بے ترتیب سٹرنگ۔ اپنے کمپیوٹر پر:
  ```bash
  openssl rand -hex 32
  ```
- اسے **پاس ورڈ مینیجر** میں رکھیں۔
- ⚠️ بعد میں بدلنے سے پرانے تمام کوڈز کے hash بے کار ہو جائیں گے (صارفین کے codes نہیں، صرف غیر استعمال شدہ واؤچرز)۔

یہ مرحلہ 3 میں، Functions code آنے کے بعد کریں۔ ابھی نہیں۔

---

## 13. مجھے کیا بتانا ہے (deploy سے پہلے)

1. **Email/Password enable کیا؟** ہاں / نہیں
2. **Blaze** پہلے سے on تھا یا آپ نے اب کیا؟
3. **Firestore location** کیا ہے؟ (`asia-south1` یا کچھ اور)
4. اگر کوئی قدم مختلف نظر آیا (Console کا UI بدلتا رہتا ہے) تو اسکرین شاٹ نہ بھیجیں — صرف لکھیں کہ کیا نظر آیا۔

---

## 14. آخر میں — فائلوں کی حقیقت

- ایجنٹ نے کوئی **deploy** نہیں کیا۔
- کوئی **UI فائل** نہیں چھیڑی گئی۔
- `firestore.rules` میں صرف **اضافہ** ہوا؛ ledger rules کی حفاظت برقرار ہے۔
- `functions/` کا scaffold `npm run build` سے compile ہو کر `lib/index.js` بناتا ہے (تصدیق شدہ)۔
- اصل activation logic **مرحلہ 3** میں آئے گا۔
