/**
 * Local payments (JazzCash / EasyPaisa) + offline activation.
 *
 * Reality check, stated up front: there is no payment gateway in this build, so
 * nothing here can *verify* that money arrived. What it does is make the manual
 * flow a shopkeeper already uses (send money → send the TID on WhatsApp →
 * receive an activation code) fast, unambiguous and auditable on the device.
 *
 * The activation code is derived from the plan + install id + month with a
 * checksum. That stops typos and casual copying; it is **not** cryptographic
 * licence enforcement, and it is documented as such in the UI copy.
 */

export type PlanId = "monthly" | "yearly" | "shop";

export type Plan = {
  id: PlanId;
  label: string;
  price: number;
  days: number;
  badge?: string;
  note: string;
  code: "M" | "Y" | "S";
};

export const PLANS: Plan[] = [
  {
    id: "monthly",
    label: "ماہانہ",
    price: 499,
    days: 30,
    note: "ہر مہینے تجدید — چھوٹی دکان کے لیے",
    code: "M",
  },
  {
    id: "yearly",
    label: "سالانہ",
    price: 4999,
    days: 365,
    badge: "2 ماہ مفت",
    note: "ایک سال — سب سے مقبول",
    code: "Y",
  },
  {
    id: "shop",
    label: "دکان لائف ٹائم",
    price: 9999,
    days: 3650,
    badge: "بہترین قیمت",
    note: "دس سال — ایک ہی ادائیگی",
    code: "S",
  },
];

export type WalletId = "jazzcash" | "easypaisa";

export type Wallet = {
  id: WalletId;
  label: string;
  latin: string;
  accent: string;
  number: string;
};

function envNumber(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  return (value ?? "").trim();
}

/** Numbers live in env, never in source — an empty value disables the button. */
export const WALLETS: Wallet[] = [
  {
    id: "jazzcash",
    label: "جاز کیش",
    latin: "JazzCash",
    accent: "#C8102E",
    number: envNumber("VITE_JAZZCASH_NUMBER"),
  },
  {
    id: "easypaisa",
    label: "ایزی پیسہ",
    latin: "EasyPaisa",
    accent: "#00A651",
    number: envNumber("VITE_EASYPAISA_NUMBER"),
  },
];

export function walletById(id: WalletId): Wallet {
  return WALLETS.find((wallet) => wallet.id === id) ?? WALLETS[0];
}

export function planById(id: PlanId): Plan {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[0];
}

/** FNV-1a — small, dependency-free and stable across devices. */
export function checksum(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(7, "0").slice(-4);
}

function monthStamp(now: number): string {
  const date = new Date(now);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Order reference shown to the buyer and quoted back on WhatsApp, e.g.
 * `SB-Y2610-A1B2` (plan, year/month, checksum).
 */
export function orderReference(planId: PlanId, seed: string, now = Date.now()): string {
  const plan = planById(planId);
  const stamp = monthStamp(now).slice(-4);
  return `SB-${plan.code}${stamp}-${checksum(`${plan.id}|${seed}|${stamp}`)}`;
}

/** JazzCash/EasyPaisa TIDs are digits; people type spaces and dashes. */
export function normaliseTid(value: string): string {
  return value.replace(/[^\d]/g, "").slice(0, 16);
}

export type TidCheck = { ok: boolean; tid: string; message: string };

export function validateTid(value: string, alreadyUsed: string[] = []): TidCheck {
  const tid = normaliseTid(value);
  if (tid.length === 0) return { ok: false, tid, message: "ٹرانزیکشن نمبر (TID) درج کریں۔" };
  if (tid.length < 6) return { ok: false, tid, message: "TID کم از کم 6 ہندسوں کا ہوتا ہے۔" };
  if (alreadyUsed.includes(tid)) {
    return { ok: false, tid, message: "یہ TID پہلے استعمال ہو چکا ہے۔" };
  }
  return { ok: true, tid, message: "" };
}

/** Code the owner sends back after the money is confirmed, e.g. SB-Y-202610-7K2Q. */
export function activationCode(planId: PlanId, installId: string, now = Date.now()): string {
  const plan = planById(planId);
  const stamp = monthStamp(now);
  return `SB-${plan.code}-${stamp}-${checksum(`${plan.id}|${installId}|${stamp}`)}`;
}

export type ActivationResult =
  | { ok: true; planId: PlanId; expiresAt: number; message: string }
  | { ok: false; message: string };

export function validateActivation(
  code: string,
  installId: string,
  now = Date.now(),
): ActivationResult {
  const cleaned = code.trim().toUpperCase().replace(/\s+/g, "");
  const match = /^SB-([MYS])-(\d{6})-([0-9A-Z]{4})$/.exec(cleaned);
  if (!match) {
    return { ok: false, message: "کوڈ کی شکل غلط ہے — مثال: SB-Y-202610-7K2Q" };
  }
  const [, letter, stamp, check] = match;
  const plan = PLANS.find((item) => item.code === letter);
  if (!plan) return { ok: false, message: "کوڈ میں پلان درست نہیں۔" };

  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6));
  if (month < 1 || month > 12) return { ok: false, message: "کوڈ کا مہینہ درست نہیں۔" };

  const expected = checksum(`${plan.id}|${installId}|${stamp}`);
  if (expected !== check) {
    return {
      ok: false,
      message: "کوڈ اس فون سے میچ نہیں کرتا — سپورٹ سے نیا کوڈ لیں۔",
    };
  }

  const issuedAt = Date.UTC(year, month - 1, 1);
  const expiresAt = issuedAt + plan.days * 86_400_000;
  if (expiresAt < now) {
    return { ok: false, message: "یہ کوڈ کی مدت ختم ہو چکی ہے — نیا کوڈ منگوائیں۔" };
  }
  return {
    ok: true,
    planId: plan.id,
    expiresAt,
    message: `${plan.label} پلان فعال ہو گیا۔`,
  };
}

export const LICENSE_STORAGE = "sautiBaqayaLicense";
export const TRIAL_DAYS = 14;

export type LicenseState = {
  firstSeenAt: number;
  activatedAt: number;
  expiresAt: number;
  planId: PlanId | null;
  code: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function defaultLicense(now = Date.now()): LicenseState {
  return { firstSeenAt: now, activatedAt: 0, expiresAt: 0, planId: null, code: "" };
}

export function loadLicense(store: StorageLike | null = storage(), now = Date.now()): LicenseState {
  if (!store) return defaultLicense(now);
  try {
    const raw = store.getItem(LICENSE_STORAGE);
    if (!raw) {
      const fresh = defaultLicense(now);
      store.setItem(LICENSE_STORAGE, JSON.stringify(fresh));
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<LicenseState>;
    return {
      firstSeenAt: Number(parsed.firstSeenAt) || now,
      activatedAt: Number(parsed.activatedAt) || 0,
      expiresAt: Number(parsed.expiresAt) || 0,
      planId: parsed.planId ?? null,
      code: typeof parsed.code === "string" ? parsed.code : "",
    };
  } catch {
    return defaultLicense(now);
  }
}

export function persistLicense(state: LicenseState, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(LICENSE_STORAGE, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

export type LicenseSnapshot = {
  status: "trial" | "active" | "expired";
  planId: PlanId | null;
  planLabel: string;
  daysLeft: number;
  expiresAt: number;
  label: string;
};

export function licenseSnapshot(state: LicenseState, now = Date.now()): LicenseSnapshot {
  const day = 86_400_000;
  if (state.planId && state.expiresAt > now) {
    return {
      status: "active",
      planId: state.planId,
      planLabel: planById(state.planId).label,
      daysLeft: Math.ceil((state.expiresAt - now) / day),
      expiresAt: state.expiresAt,
      label: `${planById(state.planId).label} فعال — ${Math.ceil((state.expiresAt - now) / day)} دن باقی`,
    };
  }
  if (state.planId) {
    return {
      status: "expired",
      planId: state.planId,
      planLabel: planById(state.planId).label,
      daysLeft: 0,
      expiresAt: state.expiresAt,
      label: "سبسکرپشن ختم ہو گئی — تجدید کریں",
    };
  }
  const trialEnd = state.firstSeenAt + TRIAL_DAYS * day;
  const daysLeft = Math.max(0, Math.ceil((trialEnd - now) / day));
  return {
    status: daysLeft > 0 ? "trial" : "expired",
    planId: null,
    planLabel: "آزمائشی",
    daysLeft,
    expiresAt: trialEnd,
    label: daysLeft > 0 ? `آزمائشی مدت — ${daysLeft} دن باقی` : "آزمائشی مدت ختم — پلان منتخب کریں",
  };
}

/** Applies a validated code and returns the new persisted state. */
export function applyActivation(
  state: LicenseState,
  code: string,
  installId: string,
  now = Date.now(),
): { state: LicenseState; result: ActivationResult } {
  const result = validateActivation(code, installId, now);
  if (!result.ok) return { state, result };
  return {
    state: {
      ...state,
      planId: result.planId,
      code: code.trim().toUpperCase(),
      activatedAt: now,
      expiresAt: result.expiresAt,
    },
    result,
  };
}

export type PaymentRequest = {
  plan: PlanId;
  wallet: WalletId;
  orderRef: string;
  tid: string;
  payerTail: string;
};

export function paymentRequestMessage(request: PaymentRequest): string {
  const plan = planById(request.plan);
  const wallet = walletById(request.wallet);
  return [
    "السلام علیکم — صوتی بقیہ سبسکرپشن کی درخواست",
    `پلان: ${plan.label} (Rs. ${plan.price})`,
    `ادائیگی: ${wallet.label}`,
    `آرڈر: ${request.orderRef}`,
    `TID: ${request.tid}`,
    request.payerTail ? `بھیجنے والا نمبر: ****${request.payerTail}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function paymentRequestUrl(
  request: PaymentRequest,
  supportNumber = (import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined) ?? "",
): { url: string; configured: boolean } {
  const text = encodeURIComponent(paymentRequestMessage(request));
  const number = supportNumber.replace(/[^\d]/g, "");
  if (!number) return { url: `https://wa.me/?text=${text}`, configured: false };
  return { url: `https://wa.me/${number}?text=${text}`, configured: true };
}
