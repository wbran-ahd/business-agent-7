# ڈیپلائے گائیڈ — صوتی بقیہ کو لائیو کریں

> **کل وقت:** پہلی بار تقریباً 20–30 منٹ، اس کے بعد ہر اپ ڈیٹ 2 منٹ۔
>
> **کیا تیار ہے:** سارا code، `firebase.json`، `.firebaserc`، rules، indexes اور functions — ایجنٹ نے بنایا اور چیک کیا۔
> **کیا آپ کو کرنا ہے:** نیچے دیے گئے کمانڈز اپنے کمپیوٹر پر چلانا۔ ایجنٹ deploy **نہیں** کرے گا۔

---

## 0. پہلے تصدیق — کیا سب کچھ upload کے لیے تیار ہے؟

| #   | چیز                                        | حالت                                              |
| --- | ------------------------------------------ | ------------------------------------------------- |
| 1   | فرانت اِند بلڈ (`bun run build`)           | ✅ `dist/` بن چکا (3.6 MB، `index.html` موجود)    |
| 2   | Functions بلڈ (`npm --prefix functions run build`) | ✅ `functions/lib/index.js` بن چکا          |
| 3   | **Hosting کا فولڈر** — `firebase.json` میں `"public": "dist"` | ✅ درست                              |
| 4   | **ریجن** — `functions/src/config.ts` میں `REGION = "asia-south1"` | ✅ ہر callable پر لگا ہوا ہے         |
| 5   | **پروجیکٹ** — `.firebaserc` میں `default` = `gen-lang-client-09792501-d8895` | ✅ موجود           |
| 6   | Firestore rules + indexes فائلیں          | ✅ `firestore.rules`، `firestore.indexes.json`     |
| 7   | تعاونی ٹیسٹ                               | ✅ 284 چیکس پاس                                   |
| 8   | Blaze پلان، Email/Password enable، admin اکاؤنٹ | ⚠️ **آپ** — `docs/FIREBASE-SETUP.md` مرحلہ 2–4 |

> **ریجن کے بارے میں:** `firebase.json` میں ریجن کی کوئی کلید ہوتی ہی نہیں — ریجن ہر فنکشن کے ساتھ کوڈ میں لگتا ہے، اور وہ `asia-south1` ہے۔ کلائنٹ بھی `getFunctions(app, "asia-south1")` استعمال کرتا ہے، اس لیے دونوں مل کر کام کرتے ہیں۔

**جو چیزیں پہلے سے بنی ہوئی ہیں (انہیں دوبارہ بنانے کی ضرورت نہیں):**

- ✅ `firebase.json` — Functions (Node 22)، rules/indexes، Hosting SPA rewrite
- ✅ `.firebaserc` — default project
- ✅ `firestore.rules` — پرانے ledger rules + نئی licensing collections
- ✅ `functions/` — 7 callables (activation، status اور پانچ ایڈمن فنکشنز)

### 4 چیزیں جو کبھی نہ کریں

1. **`firebase init` نہ چلائیں** — یہ موجودہ config اوور رائٹ کر دے گا۔
2. **`ACTIVATION_PEPPER` بعد میں نہ بدلیں** — پرانے واؤچر hashes بے کار ہو جائیں گے۔
3. **`.env`، key یا پاس ورڈ کبھی چیٹ میں نہ بھیجیں** — نہ مجھے، نہ کسی اور کو۔
4. **Service-account JSON کسی کو نہ بھیجیں** — وہ سارے rules بائیپاس کر سکتی ہے۔

---

## قدم 1 — Terminal / Command Prompt کھولیں

- **Windows:** Start میں `cmd` یا `PowerShell` لکھیں۔
- **Mac:** `Terminal` (Spotlight میں)۔
- پروجیکٹ کے فولڈر میں جائیں:

```bash
cd path/to/sauti-baqaya
```

> یہ وہی فولڈر ہے جس میں `firebase.json` موجود ہو۔ `dir` (Windows) یا `ls` (Mac) سے تصدیق کر لیں۔

---

## قدم 2 — Firebase سے لاگ اِن

```bash
firebase login
```

**یہ کیا کرتا ہے:** آپ کے براؤزر میں Google لاگ اِن کھلتا ہے → ایک ہی بار **Allow** دبائیں → آپ کا کمپیوٹر Firebase کا حوالہ بن جاتا ہے۔

- CLI انسٹال نہیں؟ پہلے: `npm install -g firebase-tools`
- پہلے سے لاگ اِن ہیں؟ یہ کمانڈ دوبارہ چلانا ضروری نہیں۔

تصدیق:

```bash
firebase projects:list
```

فہرست میں `gen-lang-client-09792501-d8895` نظر آنا چاہیے۔

---

## قدم 3 — پروجیکٹ منتخب کریں

```bash
firebase use --add
```

**یہ کیا کرتا ہے:** سبھی projects کی فہرست دکھاتا ہے —

1. `gen-lang-client-09792501-d8895` منتخب کریں۔
2. Alias پوچھے تو **`default`** لکھ کر Enter دبائیں۔

> `.firebaserc` میں یہ پہلے سے محفوظ ہے — یہ قدم صرف تصدیق ہے۔ اگر کچھ بھی نہ پوچھے تو یہ درست ہے۔

پھر:

```bash
firebase use
```

آؤٹ پوٹ میں ` gen-lang-client-09792501-d8895 ` نظر آنا چاہیے۔

---

## قدم 4 — Firestore Rules اور Indexes اپلوڈ کریں

### 4.1 Rules

```bash
firebase deploy --only firestore:rules
```

**یہ کیا کرتا ہے:** `firestore.rules` فائل سرور پر چھوڑ دیتا ہے۔ یہی وہ حفاظت ہے جو طے کرتی ہے کہ عام صارف `codes/` یا کسی اور کے licenses نہ لکھ سکے، اور ایڈمن (آپ) سب پڑھ سکے۔ **پہلے یہ، پھر ہی کچھ اور** — نئے rules کے بغیر لوگوں کی data access غلط ہو سکتی ہے۔

### 4.2 Indexes

```bash
firebase deploy --only firestore:indexes
```

**یہ کیا کرتا ہے:** `firestore.indexes.json` میں لکھی composite indexes بناتا ہے (licenses کی ترتیب والی queries کے لیے)۔ Index بننے میں 1–2 منٹ لگ سکتے ہیں۔ اس کے بغیر کچھ queries `The query requires an index` کی error دیں گی۔

> دونوں ایک ساتھ بھی چلا سکتے ہیں: `firebase deploy --only firestore`

---

## قدم 5 — Cloud Functions اپلوڈ کریں

### 5.1 پہلی بار: سریٹ (صرف ایک بار)

```bash
firebase functions:secrets:set ACTIVATION_PEPPER
```

**یہ کیا کرتا ہے:** واؤچر کوڈز کو hash کرنے والا خفیہ سٹرنگ Google Secret Manager میں جمع کرواتا ہے — کوڈ کبھی خام نہیں جاتا، صرف hash محفوظ ہوتا ہے۔

- Value پوچھے تو اپنے کمپیوٹر پر پہلے یہ چلائیں اور آؤٹ پوٹ paste کریں:
  ```bash
  openssl rand -hex 32
  ```
- آنسر **پاس ورڈ مینیجر** میں محفوظ کریں۔
- ⚠️ بعد میں اسے بدلنا پرانے unused واؤچرز کے hashes بے کار کر دے گا۔

### 5.2 پہلی بار: functions کی dependencies

```bash
cd functions
npm ci
cd ..
```

**یہ کیا کرتا ہے:** `functions/package-lock.json` کے بالکل وہی versions نصب کرتا ہے۔

### 5.3 Functions deploy

```bash
firebase deploy --only functions
```

**یہ کیا کرتا ہے:**

1. `firebase.json` کا `predeploy` خود `functions/` میں TypeScript build کرتا ہے۔
2. ساتھ `asia-south1` ریجن پر 7 فنکشنز اپلوڈ ہوتے ہیں: `activate`، `checkStatus`، `createCodes`، `listCodes`، `resetActivation`، `revokeCode`، `extendCode`۔
3. پہلی بار CLI APIs enable کرنے کی اجازت مانگے گا (Cloud Build، Artifact Registry، Cloud Run، Eventarc) — **Yes** دبائیں۔ 5–10 منٹ لگ سکتے ہیں۔

تصدیق: ختم ہونے پر آؤٹ پوٹ میں `functions[asia-south1-...]` کی فہرست نظر آنی چاہیے۔ Console میں: `https://console.firebase.google.com/project/gen-lang-client-09792501-d8895/functions`

---

## قدم 6 — Frontend (ویب سائٹ) اپلوڈ کریں

### 6.1 پہلی بار: dependencies

```bash
bun install
```

### 6.2 بلڈ

```bash
bun run typecheck
bun run build
```

**یہ کیا کرتا ہے:** پہلے TypeScript error کھوجتا ہے، پھر `dist/` فولڈر بنتا ہے — یہی وہ چیز ہے جو Hosting پر جاتی ہے۔

### 6.3 Hosting deploy

```bash
firebase deploy --only hosting
```

**یہ کیا کرتا ہے:** `dist/` کی تمام فائلیں Firebase Hosting پر اپلوڈ کرتا ہے اور SPA rewrite برقرار رکھتا ہے (اس لیے `/activate` یا `/admin` براہ راست کھولنے پر 404 نہیں آتا)۔

ختم ہونے پر لنک ملے گا:

```
https://gen-lang-client-09792501-d8895.web.app
```

---

## اگلی بار صرف ایک کمانڈ

```bash
bun run build && firebase deploy
```

**یہ کیا کرتا ہے:** فرانت بلڈ + rules + indexes + functions + hosting — سب ایک ساتھ۔ functions کا build `predeploy` خود کر لیتا ہے۔

## 📱 موبائل سے ایک ٹیپ ڈیپلائے (GitHub Actions)

کمپیوٹر یا Cloud Shell کی ضرورت نہیں۔ GitHub موبائل ایپ سے براہِ راست ڈیپلائے کریں۔

### ایک بار کی تیاری

1. GitHub → ریپو → **Settings → Secrets and variables → Actions**
2. **New repository secret** → نام: `FIREBASE_SERVICE_ACCOUNT`
   ویلیو: Firebase Console → ⚙️ Project settings → Service accounts → **Generate new private key** سے ملی JSON فائل کا پورا مواد۔
3. (صرف پہلی بار، اختیاری) دوسرا secret بنائیں: `ACTIVATION_PEPPER` — ویلیو `openssl rand -hex 32` کا نتیجہ۔

> 🔴 service-account JSON نہ ریپو میں commit کریں، نہ کسی کو بھیجیں — یہ سارے Firestore rules بائی پاس کرتی ہے۔ صرف GitHub کے secret store میں رہے۔

### ڈیپلائے کیسے کریں

1. GitHub ایپ → **Actions** → **Deploy to Firebase** → **Run workflow**
2. `targets` چنیں:
   - `hosting-and-functions` — ڈیفالٹ: UI + فنکشنز
   - `hosting-only` — صرف UI
   - `functions-only` — صرف فنکشنز
   - `everything` — rules + indexes بھی (احتیاط: جو indexes فائل میں نہیں وہ ڈیلیٹ ہو سکتے ہیں)
3. پہلی بار `set_activation_pepper` کو ✅ آن کریں — صرف اس وقت جب `ACTIVATION_PEPPER` secret سیٹ ہو۔ واؤچر بننے کے بعد اسے **کبھی** آن نہ کریں۔
4. **Run workflow** دبائیں → تقریباً 3–5 منٹ۔

یہ workflow خود یہ سب کرتا ہے: typecheck، ledger ٹیسٹ، فرانت بلڈ، functions بلڈ، اور پھر ڈیپلائے — یعنی ٹوٹا ہوا کوڈ لائیو نہیں جاتا۔

> ✅ یہ workflow صرف ہاتھ سے چلتا ہے۔ کسی push یا merge پر خودکار ڈیپلائے **نہیں** ہوتا۔

---

## ڈیپلائے کے بعد — چیک لسٹ

| #   | کیا کریں                                 | متوقع نتیجہ                                        |
| --- | ---------------------------------------- | -------------------------------------------------- |
| 1   | لنک کھولیں                               | Landing page کھل جائے                              |
| 2   | `/activate`                              | ایکٹیویشن سکرین دکھے (غلط کوڈ پر اردو error)      |
| 3   | `/admin`                                 | `/admin/login` پر جائے                             |
| 4   | اپنا ای میل + پاس ورڈ ڈالیں             | ایڈمن پینل کھل جائے                                |
| 5   | "نیا کوڈ بنائیں" → بنائیں               | QR + SAUTI-XXXX-XXXX-XXXX نظر آئے                 |
| 6   | فون کے کیمرہ سے QR اسکن کریں            | `/activate?c=...` کھلے، کوڈ خود بھرا ہو            |
| 7   | Console → Functions                      | 7 فنکشنز نظر آئیں                                 |
| 8   | Console → Firestore → Rules              | merged rules (`codes`، `licenses` شامل)            |
| 9   | Console → Authentication → Users         | آپ کا admin اکاؤنٹ + نئے anonymous صارف           |
|10   | DevTools → Console                       | کوئی سرخ error نہ ہو                               |

> 🔴 **اہم:** آپ کے admin اکاؤنٹ کا UID بالکل `vDzRVOYUgMNwcvD5oBdPVibDFFq1` ہونا چاہیے (Console → Authentication → Users میں دیکھیں)۔ اگر مختلف ہو تو پینل میں **"اس اکاؤنٹ سے رسائی ممنوع"** آئے گا — اسے بتانا، حل `admin.ts`، `firestore.rules` اور `functions/src/config.ts` میں ہے (تینوں جگہ ایک ہی UID)۔

---

## عمومی مسائل

| علامت                         | حل                                                          |
| ------------------------------ | ----------------------------------------------------------- |
| `You are not logged in`       | قدم 2 دوبارہ چلائیں                                         |
| `project is not a valid project` | قدم 3: `firebase use --add`                              |
| `Your project must be on the Blaze plan` | Firebase Console → Billing میں Blaze آن کریں         |
| `A secret with this name already exists` | پہلے سے سیٹ ہے — قدم 5.1 چھوڑ دیں                  |
| `The query requires an index` | قدم 4.2، یا error میں آیا لنک کلک کریں                     |
| `auth/operation-not-allowed`  | Console → Authentication → Sign-in method → Email/Password Enable |
| Hosting پر `/admin` 404       | `firebase.json` میں SPA rewrite چیک کریں، دوبارہ قدم 6.3   |
| پینل میں "رسائی ممنوع"        | admin UID چیک کریں (اوپر والی نوٹ)                          |
| پینل میں لسٹ خالی/error       | functions deploy ہوئے؟ قدم 5.3 — اور `ACTIVATION_PEPPER` سیٹ ہے؟ |

مزید تفصیل: `docs/FIREBASE-SETUP.md` (Console setup) اور `docs/SETUP-ACCOUNTS.md`۔

---

## 🔐 سالانہ Pepper Rotation (آڈٹ #33)

- نئی pepper پر hashes پرانے **unused واؤچرز** کے میل نہیں کھاته — rotate سے پہلے انہیں استعمال کروا دیں یا منسوخ کر دیں۔
- کمانڈز:
  ```bash
  openssl rand -hex 32
  firebase functions:secrets:set ACTIVATION_PEPPER
  firebase deploy --only functions
  ```
- پہلے سے **active licences متاثر نہیں** ہوتے — نئے activation tokens نئی pepper سے sign ہوتے ہیں۔
- سالانہ نظام: ہر سال rotate کريں، اور اگلے دن ایک نئ unused واؤچر بنا کر فون سے activate ٹیسٹ کريں۔
