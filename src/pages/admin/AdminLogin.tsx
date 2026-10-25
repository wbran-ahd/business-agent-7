/**
 * `/admin/login` — the only email/password form in the product.
 *
 * It exists for one account (the hard-coded admin uid) and never for regular
 * users, who stay anonymous behind the activation screen. Design vocabulary is
 * the same as `/activate`: `sauti-app`, `ambient-bg`, `glass-panel`, the shared
 * `inputCls`/`smallBtn` strings, sky for the primary action, rose for errors.
 */
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import logo from "@/assets/logo.svg";
import { isAdminUid, adminLoginErrorMessage } from "@/lib/admin";
import { BRAND } from "@/lib/brand";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";

/* Verbatim copies of the app's control strings (see SettingsModal/Onboarding). */
const inputCls =
  "w-full bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-400 font-sans";
const smallBtn =
  "px-3 py-2 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1.5";
const primaryBtn = `${smallBtn} border-sky-500/40 bg-sky-500/25 text-sky-100 hover:bg-sky-500/35 disabled:opacity-50 disabled:cursor-not-allowed`;

export default function AdminLogin() {
  const navigate = useNavigate();
  const { isLoading, isAuthenticated, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already the admin (second tab, back button): the form is pointless.
  useEffect(() => {
    if (!isLoading && isAuthenticated && isAdminUid(user?.uid)) {
      navigate("/admin", { replace: true });
    }
  }, [isLoading, isAuthenticated, user?.uid, navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const trimmed = email.trim();
    if (!trimmed || !password) {
      setError("ای میل اور پاس ورڈ دونوں درکار ہیں۔");
      return;
    }

    setBusy(true);
    try {
      // Drop any anonymous session first so the sign-in cannot inherit the
      // device's uid — the admin check compares against *this* account's uid.
      if (auth.currentUser) await signOut(auth).catch(() => {});
      const credential = await signInWithEmailAndPassword(auth, trimmed, password);
      if (!isAdminUid(credential.user.uid)) {
        await signOut(auth).catch(() => {});
        setError("اس اکاؤنٹ سے رسائی ممنوع ہے۔");
        return;
      }
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(adminLoginErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sauti-app min-h-screen">
      <div className="ambient-bg" aria-hidden="true" />

      <main className="relative z-10 flex min-h-screen items-center justify-center p-4">
        <section className="glass-panel m-4 w-full max-w-md p-6" aria-labelledby="admin-login-title">
          <header className="flex items-center gap-3">
            <img src={logo} alt="" className="size-16 rounded-2xl border border-white/15" />
            <div className="leading-tight">
              <p className="nastaliq text-sm text-white">{BRAND.name}</p>
              <p className="text-[10px] text-white/45">ایڈمن رسائی</p>
            </div>
          </header>

          <h1
            id="admin-login-title"
            className="nastaliq mt-5 text-xl font-bold leading-loose text-white"
          >
            ایڈمن لاگ اِن
          </h1>
          <p className="mt-1 text-xs leading-6 text-white/60">
            یہ صفحہ صرف ایڈمن اکاؤنٹ کے لیے ہے۔ عام صارف ایپ میں کوڈ سے
            ایکٹیویٹ ہوتا ہے۔
          </p>

          <form className="mt-5 flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
            <label htmlFor="admin-email" className="text-[11px] text-white/60">
              ای میل
            </label>
            <input
              id="admin-email"
              type="email"
              dir="ltr"
              autoComplete="username"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
              placeholder="admin@example.com"
              className={inputCls}
            />

            <label htmlFor="admin-password" className="text-[11px] text-white/60">
              پاس ورڈ
            </label>
            <input
              id="admin-password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
              placeholder="••••••••"
              className={inputCls}
            />

            {error && (
              <p role="alert" className="text-[11px] leading-6 text-rose-400">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className={primaryBtn}>
              {busy ? (
                <>
                  <i className="fas fa-circle-notch animate-spin"></i> جا رہا ہے…
                </>
              ) : (
                <>
                  <i className="fas fa-right-to-bracket"></i> داخل ہوں
                </>
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-[10px] leading-5 text-white/40">
            پاس ورڈ یاد نہیں؟ Firebase Console → Authentication → Users سے ری سیٹ
            کریں۔
          </p>
        </section>
      </main>
    </div>
  );
}
