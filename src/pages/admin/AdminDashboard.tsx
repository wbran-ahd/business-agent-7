/**
 * `/admin` — the voucher panel.
 *
 * Guarded by `AdminRoute` (uid check), never by the licence gate: this account
 * holds no voucher and a voucher must never be what grants admin.
 *
 * Design: the `sauti-app` shell + `ambient-bg` + `glass-panel` container from
 * Activation, `smallBtn` for every action and the app's existing semantic
 * accents (sky = primary/extend, amber = reset, rose = revoke, emerald =
 * "issued"). Nothing here introduces a colour, radius or type scale of its own.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { signOut } from "firebase/auth";
import logo from "@/assets/logo.svg";
import { BRAND } from "@/lib/brand";
import { auth } from "@/lib/firebase";
import { activationErrorMessage } from "@/lib/activation";
import { notifyDanger, notifySuccess } from "@/lib/notifications";
import {
  ADMIN_UID,
  adminExtendCode,
  adminListCodes,
  adminResetActivation,
  adminRevokeCode,
  type CodeRow,
  type IssuedCode,
} from "@/lib/admin";
import { useAuth } from "@/hooks/use-auth";
import { CreateCodeModal } from "./components/CreateCodeModal";
import { CodesTable } from "./components/CodesTable";

/* Verbatim copies of the app's control strings (see SettingsModal/Onboarding). */
const smallBtn =
  "px-3 py-2 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1.5";
const primaryBtn = `${smallBtn} w-full border-sky-500/40 bg-sky-500/25 py-3 text-sm text-sky-100 hover:bg-sky-500/35 disabled:opacity-50 disabled:cursor-not-allowed`;
const ghostBtn = `${smallBtn} border-white/20 bg-white/10 text-white/80 hover:bg-white/20`;
const uidChip =
  "rounded-full border border-white/15 bg-white/5 px-2 py-0.5 font-sans text-[10px] text-white/55";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [rows, setRows] = useState<CodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /** Plaintext codes only exist at creation time — the server keeps a hash. */
  const [issued, setIssued] = useState<Record<string, string>>({});

  /**
   * First fetch, inlined into the effect.
   *
   * `use-license` sets the pattern this file follows: no state is touched
   * before the first `await`, so the effect never triggers a synchronous
   * cascade. Later refreshes go through {@link reload}, which may show the
   * spinner because it runs from event handlers.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const codes = await adminListCodes(50);
        if (cancelled) return;
        setRows(codes);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(activationErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Spinner + fetch — called from event handlers, never from an effect. */
  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setRows(await adminListCodes(50));
      setError(null);
    } catch (err) {
      setError(activationErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo(() => {
    return {
      total: rows.length,
      ready: rows.filter((row) => !row.revoked && !row.used_by_uid).length,
      used: rows.filter((row) => Boolean(row.used_by_uid)).length,
      revoked: rows.filter((row) => row.revoked).length,
    };
  }, [rows]);

  /** One wrapper for the four row actions: busy flag, toast, refresh. */
  async function runAction(
    codeId: string,
    action: () => Promise<void>,
    successTitle: string,
  ) {
    if (busyId) return;
    setBusyId(codeId);
    try {
      await action();
      notifySuccess(successTitle);
      await reload();
    } catch (err) {
      notifyDanger("نہیں ہو سکا", activationErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  function onReset(row: CodeRow) {
    const confirmed = window.confirm(
      `کوڈ ${row.masked} ری سیٹ کر دیں؟\n\nپرانے ڈیوپل ہٹ جائیں گے اور کوڈ دوبارہ نئے فون پر ایکٹیو ہو سکے گا۔`,
    );
    if (!confirmed) return;
    void runAction(
      row.id,
      () => adminResetActivation(row.id, "admin panel"),
      "ری سیٹ ہو گیا",
    );
  }

  function onRevoke(row: CodeRow) {
    const confirmed = window.confirm(
      `کوڈ ${row.masked} منسوخ کر دیں؟\n\nیہ کوڈ ہمیشہ کے لیے بند ہو جائے گا اور جس فون پر چل رہا ہے وہ اگلی بار کام نہیں کرے گا۔`,
    );
    if (!confirmed) return;
    void runAction(
      row.id,
      () => adminRevokeCode(row.id),
      "کوڈ منسوخ ہو گیا",
    );
  }

  function onExtend(row: CodeRow) {
    const answer = window.prompt(
      `کوڈ ${row.masked} کی میعاد کتنے دن بڑھائیں؟\n\nمثبت عدد لکھیں (مثلاً 30)۔`,
      "30",
    );
    if (answer === null) return;
    const days = Number(answer.trim());
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      notifyDanger("میعاد درست نہیں", "1 سے 3650 دن کے درمیان عدد لکھیں۔");
      return;
    }
    void runAction(
      row.id,
      async () => {
        await adminExtendCode(row.id, days);
      },
      `میعاد ${days} دن بڑھ گئی`,
    );
  }

  async function onCopy(row: CodeRow) {
    const plain = issued[row.id];
    if (!plain) {
      notifyDanger(
        "کوڈ محفوظ نہیں ہے",
        "کوڈ صرف بنائے گئے وقت ظاہر ہوتا ہے — پرانے کوڈ نیا بنا کر دوبارہ لیں۔",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(plain);
      notifySuccess("کوڈ کاپی ہو گیا", plain);
    } catch {
      notifyDanger("کاپی نہیں ہو سکا", "خود select کر کے کاپی کریں۔");
    }
  }

  function onCreated(issuedCode: IssuedCode) {
    setIssued((current) => ({ ...current, [issuedCode.codeId]: issuedCode.code }));
    void reload();
  }

  async function onSignOut() {
    await signOut(auth).catch(() => {});
    navigate("/admin/login", { replace: true });
  }

  return (
    <div className="sauti-app min-h-screen">
      <div className="ambient-bg" aria-hidden="true" />

      <main className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col p-4">
        <section className="glass-panel m-2 w-full p-6" aria-labelledby="admin-title">
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src={logo}
                alt=""
                className="size-12 rounded-2xl border border-white/15"
              />
              <div className="leading-tight">
                <p className="nastaliq text-sm text-white">{BRAND.name}</p>
                <p className="text-[10px] text-white/45">ایڈمن پینل — کوڈز</p>
              </div>
            </div>
            <button type="button" onClick={() => void onSignOut()} className={ghostBtn}>
              <i className="fas fa-right-from-bracket"></i> خروج
            </button>
          </header>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className={uidChip} dir="ltr">
              uid: {user?.uid ?? ADMIN_UID}
            </span>
            <span className={uidChip}>{BRAND.version}</span>
          </div>

          <h1
            id="admin-title"
            className="nastaliq mt-4 text-xl font-bold leading-loose text-white"
          >
            بنائے گئے کوڈز
          </h1>

          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-sans text-[11px] text-white/55">
            <span>کل: {stats.total}</span>
            <span className="text-sky-300">تیار: {stats.ready}</span>
            <span className="text-emerald-300">استعمال شدہ: {stats.used}</span>
            <span className="text-rose-300">منسوخ: {stats.revoked}</span>
          </div>

          <button
            type="button"
            className={`${primaryBtn} mt-4`}
            onClick={() => setCreateOpen(true)}
          >
            <i className="fas fa-plus"></i> نیا کوڈ بنائیں
          </button>

          <div className="mt-4">
            <CodesTable
              rows={rows}
              loading={loading}
              error={error}
              busyId={busyId}
              issued={issued}
              onReset={onReset}
              onRevoke={onRevoke}
              onExtend={onExtend}
              onCopy={(row) => void onCopy(row)}
              onRetry={() => void reload()}
            />
          </div>

          <p className="mt-4 border-t border-white/10 pt-3 text-[10px] leading-5 text-white/40">
            ہر کوڈ کا متن صرف بنائے گئے وقت ظاہر ہوتا ہے (سیرور پر صرف ہیش
            محفوظ ہے) — بناتے ہی واٹس ایپ پر بھیج دیں۔
          </p>
        </section>
      </main>

      <CreateCodeModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onCreated}
      />
    </div>
  );
}
