/**
 * صوتی بقیہ — landing page.
 *
 * Midnight-aurora glass theme that mirrors the app shell: same ambient mesh,
 * same emerald/sky/amber accents, Nastaliq for Urdu display type and a sans
 * body so Latin copy stays readable.
 *
 * Flow: every primary CTA sends the visitor to `/dashboard`; the route gate
 * and a signed-in visitor's CTA becomes "open dashboard" instead.
 */
import logo from "@/assets/logo.svg";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowLeft,
  BellRing,
  Check,
  Cloud,
  FileSpreadsheet,
  Languages,
  Mic,
  PieChart,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { motion, type MotionProps } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router";

const ENTER_APP = "/dashboard";

const primaryCta =
  "inline-flex cursor-pointer items-center gap-2 rounded-full border border-sky-400/60 bg-sky-500 px-6 py-3 text-sm font-bold text-white transition hover:bg-sky-400";
const ghostCta =
  "inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-bold text-white/85 transition hover:bg-white/10 hover:text-white";

const fadeUp: MotionProps = {
  initial: { opacity: 0, y: 26 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.3 },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
};

/* ------------------------------------------------------------------ */
/* Hero transcript demo                                                */
/* ------------------------------------------------------------------ */
const DEMO_LINES = [
  {
    said: "پانچ سو روپے چائے پر خرچ",
    reply: "✓ 500 روپے خرچہ درج ہو گیا",
    tone: "text-emerald-300",
  },
  {
    said: "دس ہزار تنخواہ آئی",
    reply: "✓ 10,000 روپے آمدنی درج ہو گئی",
    tone: "text-sky-300",
  },
  {
    said: "ماہانہ مالیاتی مشورہ دو",
    reply: "💡 اس مہینے آپ نے 42% رقمة بچائی",
    tone: "text-amber-300",
  },
];

const FEATURES = [
  {
    icon: Mic,
    title: "بول کر درج کریں",
    body: '"اے منشی" کہہ کر مائیک دبائیں، رقم اور تفصیل بولیں — تصدیق کے بعد انٹری فوراً درج۔',
    accent: "text-sky-300 bg-sky-500/15 border-sky-500/30",
  },
  {
    icon: Sparkles,
    title: "اے آئی مالیاتی مشورہ",
    body: "آپ کے اپنے ماہانہ ڈیٹا پر تجزیہ: سب سے بڑا خرچہ، بچت کا تناسب اور خطرے کی سطح۔",
    accent: "text-amber-300 bg-amber-500/15 border-amber-500/30",
  },
  {
    icon: Cloud,
    title: "کلاؤڈ سینک",
    body: "ورژن چیک کے ساتھ اپ لوڈ / ڈاؤن لوڈ — پرانا ڈیٹا کبھی خاموشی سے بدلتا نہیں۔",
    accent: "text-sky-300 bg-sky-500/15 border-sky-500/30",
  },
  {
    icon: PieChart,
    title: "چارٹس اور رجحان",
    body: "پچھلے 6 ماہ کا آمدنی-خرچہ رجحان اور قسم وار خرچہ، ایک نظر میں۔",
    accent: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30",
  },
  {
    icon: BellRing,
    title: "بجٹ الرٹس",
    body: "ہر category کی ماہانہ حد مقرر کریں — حد ختم ہوتے ہی انتباہ نظر آجائے گا۔",
    accent: "text-rose-300 bg-rose-500/15 border-rose-500/30",
  },
  {
    icon: FileSpreadsheet,
    title: "مکمل بیک اپ",
    body: "CSV/JSON میں ڈاؤن لوڈ، واپس لانا اور ماہانہ رپورٹ واٹس ایپ پر شیئر۔",
    accent: "text-sky-300 bg-sky-500/15 border-sky-500/30",
  },
];

const STEPS = [
  {
    n: "۰۱",
    title: "اے منشی کہہ کر مائیک دبائیں",
    body: "آواز کی کلید (”اے منشی“) سن کر منشی سننا شروع کر دیتا ہے — یا نیچے والے بٹن سے براہِ راست بولیں۔",
  },
  {
    n: "۰۲",
    title: "رقم اور تفصیل بولیں",
    body: 'مثلاً "دس ہزار گھر کا کرایہ" — منشی پوچھے گا "دراج کروں؟" اور category خود پہچان لے گا۔',
  },
  {
    n: "۰۳",
    title: "ہاں کہہ دیں، بقایا اپڈیٹ",
    body: "تصدیق کے بعد انٹری محفوظ، بقایا فوراً بدل جاتا ہے۔ غلطی ہو تو واپس لینا بھی آواز سے۔",
  },
];

const PHRASES = [
  { urdu: "پانچ سو روپے چائے پر خرچ", hint: "یعنی: چائے پر 500 روپے کا خرچہ" },
  { urdu: "بیس ہزار تنخواہ آمدی", hint: "یعنی: 20,000 روپے آمدنی درج کریں" },
  { urdu: "گاڑی کا پٹرول اڑا گیا", hint: "یعنی: خودکار قسم پہچانی گئی — سفر" },
  { urdu: "آخری انٹری واپس لو", hint: "یعنی: آخری درج شدہ انٹری منسوخ کریں" },
  { urdu: "اس مہینے کا تجزیہ دو", hint: "یعنی: اے آئی سے ماہانہ تجزیہ کروائیں" },
  { urdu: "بجٹ کے بارے میں بتاؤ", hint: "یعنی: بجٹ اور بچت کا مشورہ لیں" },
];

const SECURITY = [
  "ورژن-محفوظ سینک — تضاد کی صورت میں پہلے ڈاؤن لوڈ کیا جاتا ہے",
  "Gemini API کی سرور پر AES-GCM انکرپشن کے ساتھ محفوظ ہوتی ہے",
  "روزانہ AI کوٹا، تاکہ کلید کا استعمال کنٹرول میں رہے",
  "مکمل CSV/JSON ایکسپورٹ — آپ کا ڈیٹا ہمیشہ آپ کا",
  "داخلہ صرف ایکٹیویشن کوڈ سے — کوئی فارم نہیں، کھاتہ فوراً تیار",
];

function SectionHeading({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub: string;
}) {
  return (
    <motion.div {...fadeUp} className="mx-auto mb-12 max-w-2xl text-center">
      <p className="text-[11px] font-bold text-sky-300">{kicker}</p>
      <h2 className="nastaliq mt-4 text-3xl leading-[1.8] text-white sm:text-4xl">{title}</h2>
      <p className="mt-4 text-sm leading-7 text-white/55">{sub}</p>
    </motion.div>
  );
}

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const [line, setLine] = useState(0);

  useEffect(() => {
    const id = window.setInterval(
      () => setLine((current) => (current + 1) % DEMO_LINES.length),
      3200,
    );
    return () => window.clearInterval(id);
  }, []);

  const active = DEMO_LINES[line] ?? DEMO_LINES[0];

  return (
    <div dir="rtl" className="sauti-app sauti-page sans min-h-screen">
      <div className="ambient-bg" />

      {/* ---------------------------------------------------------- Navbar */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label="صفحۂ اول">
            <img src={logo} alt="صوتی بقیہ" className="size-9 rounded-xl border border-white/15" />
            <span className="leading-tight">
              <span className="nastaliq block text-sm text-white">صوتی بقیہ</span>
              <span className="block text-[10px] text-white/40">اردو وائس فنانس اسسٹنٹ</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-white/60 md:flex">
            <a href="#features" className="transition hover:text-white">
              امکانات
            </a>
            <a href="#how" className="transition hover:text-white">
              کیسے کام کرتا ہے
            </a>
            <a href="#voice" className="transition hover:text-white">
              وائس نمونے
            </a>
            <a href="#security" className="transition hover:text-white">
              سیکیورٹی
            </a>
          </nav>

          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Link to="/dashboard" className={`${primaryCta} px-4 py-2 sm:px-5 sm:py-2.5`}>
                ڈیش بورڈ کھولیں
              </Link>
            ) : (
              <>
                <Link
                  to={ENTER_APP}
                  className={`${ghostCta} hidden px-4 py-2 sm:inline-flex sm:px-5 sm:py-2.5`}
                >
                  ایکٹیویٹ کریں
                </Link>
                <Link to={ENTER_APP} className={`${primaryCta} px-4 py-2 sm:px-5 sm:py-2.5`}>
                  مفت شروع کریں
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ Hero */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-4 py-1.5 text-[11px] font-bold text-amber-300">
            <Sparkles className="size-3.5" />
            نیا: اے آئی سے ماہانہ مالیاتی مشورہ
          </span>

          <h1 className="nastaliq mt-6 text-4xl leading-[1.7] text-white sm:text-5xl lg:text-6xl">
            اپنا کھاتہ <span className="text-sky-300">بول کر</span> لکھیں
          </h1>

          <p className="mt-5 max-w-xl text-base leading-8 text-white/60">
            صوتی بقیہ ایک وائس-کنٹرولڈ مالیاتی منشی ہے۔ آمدنی اور خرچہ بولیں، اے آئی سے مشورہ
            لیں، اور ہر مہینے کا بقایا ہمیشہ نظر کے سامنے — بغیر ایک لفظ لکھے۔
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to={ENTER_APP} className={primaryCta}>
              مفت شروع کریں
              <ArrowLeft className="size-4" />
            </Link>
            <Link
              to={ENTER_APP}
              className={ghostCta}
            >
              {isAuthenticated ? "میرا کھاتہ دیکھیں" : "ایکٹیویشن کوڈ درج کریں"}
            </Link>
          </div>

          <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-white/50">
            {["کلاؤڈ سینک", "CSV بیک اپ", "بجٹ الرٹس", "اردو وائس کنٹرول"].map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <Check className="size-3.5 text-emerald-400" />
                {item}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* App preview card */}
        <motion.div
          initial={{ opacity: 0, y: 36 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="relative rounded-3xl border border-white/15 bg-white/5 p-5 backdrop-blur-2xl sm:p-6"
        >
          <div className="flex items-center justify-between text-[10px] text-white/40">
            <span className="flex items-center gap-1.5">
              <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
              آواز ایکٹو
            </span>
            <span>اسپیکٹرل گرڈ</span>
          </div>

          {/* Metrics */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center">
              <p className="text-[11px] text-white/50">کل رقم</p>
              <p className="mt-1 text-lg font-bold text-emerald-400">85,000</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center">
              <p className="text-[11px] text-white/50">خرچہ</p>
              <p className="mt-1 text-lg font-bold text-rose-400">37,450</p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 p-3 text-center">
              <p className="text-[11px] font-bold text-white/70">بقایا</p>
              <p className="mt-1 text-xl font-bold text-white">47,550</p>
            </div>
          </div>

          {/* Cycling transcript */}
          <div className="mt-4 min-h-[92px] rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="nastaliq text-base leading-[2] text-white/85">“{active.said}”</p>
            <motion.p
              key={line}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className={`nastaliq mt-1 text-sm leading-[2] font-bold ${active.tone}`}
            >
              {active.reply}
            </motion.p>
          </div>

          {/* Mic orb */}
          <div className="mt-5 flex items-center justify-center gap-4">
            <div className="relative flex size-20 items-center justify-center">
              <motion.span
                className="absolute inset-0 rounded-full border border-sky-400/50"
                animate={{ scale: [1, 1.35], opacity: [0.7, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.span
                className="absolute inset-0 rounded-full border border-sky-400/40"
                animate={{ scale: [1, 1.35], opacity: [0.7, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay: 1.1 }}
              />
              <span className="relative flex size-16 items-center justify-center rounded-full border border-sky-400/60 bg-sky-500/25">
                <Mic className="size-7 text-sky-200" />
              </span>
            </div>
            <p className="text-xs leading-6 text-white/45">
              بولیں <span className="text-sky-300">“اے منشی”</span>
              <br />
              یا مائیک دبائیں — باقی منشی خود سنبھال لے گا۔
            </p>
          </div>
        </motion.div>
      </section>

      {/* -------------------------------------------------------- Features */}
      <section id="features" className="border-t border-white/10 bg-black/20 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            kicker="خصوصیات"
            title="ایک کھاتہ، مکمل کنٹرول"
            sub="وائس، اے آئی، بجٹ اور بیک اپ — سب ایک ہی پینل میں، اردو میں۔"
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <motion.article
                  key={feature.title}
                  {...fadeUp}
                  transition={{ ...fadeUp.transition, delay: index * 0.07 }}
                  className="group rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl transition hover:border-sky-400/40 hover:bg-white/[0.08]"
                >
                  <span
                    className={`flex size-11 items-center justify-center rounded-xl border ${feature.accent}`}
                  >
                    <Icon className="size-5" />
                  </span>
                  <h3 className="nastaliq mt-4 text-xl leading-[1.9] text-white">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-white/55">{feature.body}</p>
                </motion.article>
              );
            })}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- How it works */}
      <section id="how" className="py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            kicker="طریقۂ کار"
            title="تین قدم، کھاتہ تیار"
            sub="لکھنا نہیں پڑتا — بولیں، تصدیق کریں، اور آگے بڑھیں۔"
          />

          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <motion.div
                key={step.n}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: index * 0.1 }}
                className="relative rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl"
              >
                <span className="text-3xl font-bold text-sky-400/70">{step.n}</span>
                <h3 className="nastaliq mt-3 text-lg leading-[1.9] text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-7 text-white/55">{step.body}</p>
              </motion.div>
            ))}
          </div>

          <motion.p
            {...fadeUp}
            className="mx-auto mt-8 max-w-2xl rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-center text-sm leading-7 text-white/55"
          >
            آواز پسند نہیں؟ ہر انٹری <span className="text-white/80">نئی / ترمیم / حذف</span> کے
            ساتھ دستی طور پر بھی درج ہو سکتی ہے — نوٹ پیڈ، تلاش اور category فلٹر کے ساتھ۔
          </motion.p>
        </div>
      </section>

      {/* ------------------------------------------------- Voice samples */}
      <section id="voice" className="border-y border-white/10 bg-black/20 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            kicker="وائس نمونے"
            title="یوں بولیے، یوں درج ہوگا"
            sub="اردو میں بولے گئے جملے منشی کو رقم، قسم اور تفصیل سب سمجھ آتی ہیں۔"
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PHRASES.map((phrase, index) => (
              <motion.div
                key={phrase.urdu}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: index * 0.06 }}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-sky-400/40"
              >
                <p className="flex items-start gap-2 text-base leading-[2] text-white/90">
                  <Mic className="mt-2 size-4 shrink-0 text-sky-400" />
                  <span className="nastaliq">{phrase.urdu}</span>
                </p>
                <p className="mt-2 text-xs leading-6 text-white/40">
                  {phrase.hint}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- Security */}
      <section id="security" className="py-16 sm:py-20">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
          <motion.div {...fadeUp}>
            <p className="text-[11px] font-bold text-sky-300">سیکیورٹی اور سینک</p>
            <h2 className="nastaliq mt-4 text-3xl leading-[1.8] text-white sm:text-4xl">
              آپ کا ڈیٹا، آپ کے کنٹرول میں
            </h2>
            <p className="mt-4 text-sm leading-7 text-white/55">
              کھاتہ مقامی طور پر محفوظ رہتا ہے اور ایکٹیویشن کے بعد کلاؤڈ پر ہم آہنگ ہو جاتا ہے —
              ہر اپ لوڈ ورژن چیک کے ساتھ، تاکہ نیا ڈیٹا کبھی خاموشی میں نہ ہٹے۔
            </p>
            <Link to={ENTER_APP} className={`${primaryCta} mt-7`}>
              ابھی شروع کریں
              <ArrowLeft className="size-4" />
            </Link>
          </motion.div>

          <motion.ul {...fadeUp} className="space-y-3">
            {SECURITY.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-7 text-white/65"
              >
                <ShieldCheck className="mt-1 size-4 shrink-0 text-emerald-400" />
                {item}
              </li>
            ))}
          </motion.ul>
        </div>
      </section>

      {/* ----------------------------------------------------------- CTA */}
      <section className="border-t border-white/10 bg-black/25 py-16 sm:py-20">
        <motion.div {...fadeUp} className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[11px] font-bold text-white/60">
            <Languages className="size-3.5" />
            اردو میں، آپ کی آواز میں
          </span>
          <h2 className="nastaliq mt-5 text-3xl leading-[1.8] text-white sm:text-4xl">
            آج ہی اپنا صوتی بقیہ شروع کریں
          </h2>
          <p className="mt-4 text-sm leading-7 text-white/55">
            ایکٹیویشن کوڈ ڈالیں — کھاتہ فوراً تیار ہے، کوئی اکاؤنٹ بنانے کی ضرورت نہیں۔
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to={ENTER_APP} className={primaryCta}>
              {isAuthenticated ? "ڈیش بورڈ کھولیں" : "مفت شروع کریں"}
              <ArrowLeft className="size-4" />
            </Link>
            <a href="#features" className={ghostCta}>
              امکانات دیکھیں
            </a>
          </div>
        </motion.div>
      </section>

      {/* -------------------------------------------------------- Footer */}
      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:px-6 md:flex-row">
          <Link to="/" className="flex items-center gap-2.5" aria-label="صفحۂ اول">
            <img src={logo} alt="صوتی بقیہ" className="size-8 rounded-lg border border-white/15" />
            <span className="nastaliq text-sm text-white/80">صوتی بقیہ</span>
          </Link>

          <nav className="flex flex-wrap items-center justify-center gap-5 text-xs text-white/45">
            <a href="#features" className="transition hover:text-white">
              امکانات
            </a>
            <a href="#how" className="transition hover:text-white">
              کیسے کام کرتا ہے
            </a>
            <a href="#voice" className="transition hover:text-white">
              وائس نمونے
            </a>
            <Link to={ENTER_APP} className="transition hover:text-white">
              ایکٹیویٹ کریں
            </Link>
          </nav>

          <p className="text-xs text-white/35">
            © {new Date().getFullYear()} صوتی بقیہ — Sauti Baqaya
          </p>
        </div>
      </footer>
    </div>
  );
}
