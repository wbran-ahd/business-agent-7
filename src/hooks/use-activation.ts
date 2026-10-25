/**
 * The `/activate` form: typed or QR-scanned code → `activate` callable.
 *
 * Keeps the field, the validation message and the busy flag; navigation and
 * the licence refresh belong to the screen that renders it.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  activationErrorMessage,
  activateCode,
  CODE_PATTERN,
  formatCode,
} from "@/lib/activation";
import { getDeviceId } from "@/lib/device-id";

const FIELD_ALLOWED = /[^A-Z0-9-]/g;

/**
 * Reads `/activate?c=…` or `/activate#c=…` (audit #18: hash payloads are
 * never sent to any server) once, while the hook state is being initialised —
 * no effect, no second render. Returns `""` when there is no payload.
 */
function readQrCode(): string {
  if (typeof window === "undefined") return "";
  const fromHash = /[#&]c=([^&]+)/.exec(window.location.hash);
  const raw =
    fromHash?.[1] ?? new URLSearchParams(window.location.search).get("c") ?? "";
  return raw ? formatCode(raw) : "";
}

export function useActivation() {
  const navigate = useNavigate();
  const [qrCode] = useState(readQrCode);
  const [code, setCodeValue] = useState(qrCode);
  const [cameFromQr] = useState(qrCode !== "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Decision 3: the camera app only opens a URL — `/activate?c=SAUTI-…` — so
   * the field fills itself from `?c=` and the parameter is stripped from the
   * address bar (it must not survive a reload or a share).
   */
  useEffect(() => {
    if (!cameFromQr) return;
    navigate(
      { pathname: window.location.pathname, search: "", hash: "" },
      { replace: true },
    );
  }, [cameFromQr, navigate]);

  /** While typing: uppercase and drop characters the code can never contain. */
  const setCode = useCallback((value: string) => {
    setCodeValue(value.toUpperCase().replace(FIELD_ALLOWED, ""));
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    if (busy) return;
    setError(null);

    const normalized = formatCode(code);
    if (!CODE_PATTERN.test(normalized)) {
      setError("کوڈ درست فارمیٹ میں نہیں ہے — SAUTI-XXXX-XXXX-XXXX لکھیں۔");
      return;
    }

    setBusy(true);
    try {
      await activateCode(normalized, getDeviceId());
      navigate("/", { replace: true });
    } catch (err) {
      setError(activationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [busy, code, navigate]);

  return { code, setCode, error, busy, submit };
}
