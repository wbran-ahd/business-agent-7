/**
 * Field-testing telemetry.
 *
 * There is no analytics SDK and no network call by default: this is a local,
 * privacy-safe ring buffer so a shopkeeper (or a tester visiting shops) can
 * export what actually happened on the device — which flows were used, which
 * failed, and on what kind of phone.
 *
 * Rules that keep it safe:
 *   • never record amounts, names, phone numbers or free-text detail;
 *   • string props are truncated and control characters stripped;
 *   • the buffer is capped, so it can never fill the device storage.
 *
 * An optional `VITE_TELEMETRY_URL` can receive a batched POST, but the default
 * build stays entirely offline.
 */

export type EventProp = string | number | boolean;

export type TelemetryEvent = {
  /** Monotonic-ish id so two events in the same ms stay distinct. */
  id: string;
  name: string;
  at: number;
  props: Record<string, EventProp>;
};

export type TelemetrySummary = {
  total: number;
  firstAt: number | null;
  lastAt: number | null;
  counts: Record<string, number>;
  activeDays: number;
};

export const TELEMETRY_STORAGE = "sautiBaqayaTelemetry";
/** Old events fall off the front — a phone should never grow this forever. */
export const TELEMETRY_LIMIT = 300;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Strips control chars and trims long strings so no detail text leaks in. */
export function sanitiseProps(props: Record<string, unknown> = {}): Record<string, EventProp> {
  const clean: Record<string, EventProp> = {};
  for (const [rawKey, rawValue] of Object.entries(props)) {
    const key = rawKey.replace(/[^\w.:-]/g, "").slice(0, 32);
    if (!key) continue;
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      clean[key] = Math.round(rawValue * 100) / 100;
    } else if (typeof rawValue === "boolean") {
      clean[key] = rawValue;
    } else if (typeof rawValue === "string") {
      // eslint-disable-next-line no-control-regex
      const value = rawValue.replace(/[\u0000-\u001f\u007f]/g, "").trim();
      if (value) clean[key] = value.slice(0, 40);
    }
  }
  return clean;
}

export function loadEvents(store: StorageLike | null = storage()): TelemetryEvent[] {
  if (!store) return [];
  try {
    const raw = store.getItem(TELEMETRY_STORAGE);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is TelemetryEvent =>
        !!item &&
        typeof item === "object" &&
        typeof (item as TelemetryEvent).name === "string" &&
        typeof (item as TelemetryEvent).at === "number",
    );
  } catch {
    return [];
  }
}

function persist(events: TelemetryEvent[], store: StorageLike | null): void {
  if (!store) return;
  try {
    store.setItem(TELEMETRY_STORAGE, JSON.stringify(events));
  } catch {
    /* Private mode / quota — telemetry must never break the app. */
  }
}

/**
 * Appends one event and returns the new buffer. Pure apart from `store`, so the
 * test suite can drive it with an in-memory implementation.
 */
export function recordEvent(
  name: string,
  props: Record<string, unknown> = {},
  options: { store?: StorageLike | null; now?: number; limit?: number } = {},
): TelemetryEvent[] {
  const store = options.store === undefined ? storage() : options.store;
  const now = options.now ?? Date.now();
  const limit = options.limit ?? TELEMETRY_LIMIT;
  const event: TelemetryEvent = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.slice(0, 48),
    at: now,
    props: sanitiseProps(props),
  };
  const next = [...loadEvents(store), event].slice(-limit);
  persist(next, store);
  return next;
}

export function clearEvents(store: StorageLike | null = storage()): void {
  store?.removeItem(TELEMETRY_STORAGE);
}

export function summarise(events: TelemetryEvent[]): TelemetrySummary {
  const counts: Record<string, number> = {};
  const days = new Set<string>();
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  for (const event of events) {
    counts[event.name] = (counts[event.name] ?? 0) + 1;
    days.add(new Date(event.at).toISOString().slice(0, 10));
    if (firstAt === null || event.at < firstAt) firstAt = event.at;
    if (lastAt === null || event.at > lastAt) lastAt = event.at;
  }
  return { total: events.length, firstAt, lastAt, counts, activeDays: days.size };
}

/** Device snapshot. No user identifiers beyond the locally generated install id. */
export type DeviceSnapshot = {
  online: boolean;
  standalone: boolean;
  language: string;
  timezone: string;
  screen: string;
  platform: string;
  userAgent: string;
};

export function deviceSnapshot(): DeviceSnapshot {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return {
      online: false,
      standalone: false,
      language: "ur",
      timezone: "UTC",
      screen: "0x0",
      platform: "unknown",
      userAgent: "unknown",
    };
  }
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    online: navigator.onLine !== false,
    standalone,
    language: navigator.language || "ur",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    screen: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
    platform: navigator.platform || "unknown",
    userAgent: navigator.userAgent.slice(0, 180),
  };
}

export type FieldReport = {
  app: string;
  version: string;
  generatedAt: string;
  installId: string;
  device: DeviceSnapshot;
  summary: TelemetrySummary;
  events: TelemetryEvent[];
};

export const INSTALL_ID_STORAGE = "sautiBaqayaInstallId";

export function installId(store: StorageLike | null = storage()): string {
  const existing = store?.getItem(INSTALL_ID_STORAGE);
  if (existing) return existing;
  const created = `ins-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    store?.setItem(INSTALL_ID_STORAGE, created);
  } catch {
    /* ignore */
  }
  return created;
}

export function buildFieldReport(input: {
  events: TelemetryEvent[];
  version: string;
  installId: string;
  device?: DeviceSnapshot;
  now?: number;
}): FieldReport {
  return {
    app: "sauti-baqaya",
    version: input.version,
    generatedAt: new Date(input.now ?? Date.now()).toISOString(),
    installId: input.installId,
    device: input.device ?? deviceSnapshot(),
    summary: summarise(input.events),
    events: input.events,
  };
}

/**
 * Best-effort remote batch, only when the owner configured a collector.
 * Never throws and never blocks the UI.
 */
export function sendBatch(events: TelemetryEvent[], url?: string): boolean {
  const endpoint = url ?? (import.meta.env.VITE_TELEMETRY_URL as string | undefined);
  if (!endpoint || events.length === 0 || typeof navigator === "undefined") return false;
  try {
    const body = JSON.stringify({ app: "sauti-baqaya", events: events.slice(-50) });
    if (typeof navigator.sendBeacon === "function") {
      return navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
    }
    void fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Fire-and-forget helper used by the UI. */
export function track(name: string, props: Record<string, unknown> = {}): void {
  try {
    recordEvent(name, props);
  } catch {
    /* telemetry must never surface an error */
  }
}
