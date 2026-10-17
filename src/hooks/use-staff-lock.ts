/**
 * `useStaffLock` — owner vs salesman mode behind a local PIN.
 *
 * Switching *into* salesman mode needs no PIN (a shopkeeper handing the phone
 * over should be one tap); coming back to owner mode always asks for it.
 */
import {
  checkPin,
  createPin,
  lockState,
  removePin,
  setStaffMode,
  validPin,
  type StaffMode,
} from "@/lib/staff-lock";
import { useCallback, useState } from "react";

export function useStaffLock() {
  const [state, setState] = useState(() => lockState());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback((message = "") => {
    setState(lockState());
    setError(message);
  }, []);

  const savePin = useCallback(
    async (pin: string, confirm: string): Promise<boolean> => {
      if (!validPin(pin)) {
        setError("PIN 4 سے 8 ہندسوں کا ہونا چاہیے۔");
        return false;
      }
      if (pin !== confirm) {
        setError("دونوں PIN مختلف ہیں۔");
        return false;
      }
      setBusy(true);
      try {
        const ok = await createPin(pin);
        if (!ok) {
          setError("PIN محفوظ نہیں ہو سکا۔");
          return false;
        }
        refresh("PIN محفوظ ہو گیا۔");
        return true;
      } catch {
        setError("اس براؤزر میں PIN محفوظ نہیں ہو سکتا (محفوظ کنکشن درکار ہے)۔");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  /** Leaving salesman mode — always requires the PIN. */
  const unlock = useCallback(
    async (pin: string): Promise<boolean> => {
      setBusy(true);
      try {
        if (!state.hasPin) {
          setError("پہلے سیٹنگز میں PIN سیٹ کریں۔");
          return false;
        }
        if (!(await checkPin(pin))) {
          setError("غلط PIN — دوبارہ کوشش کریں۔");
          return false;
        }
        setStaffMode("owner");
        refresh();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [refresh, state.hasPin],
  );

  const lockOwner = useCallback(() => {
    if (!state.hasPin) {
      setError("سیلز مین موڈ کے لیے پہلے PIN سیٹ کریں۔");
      return false;
    }
    setStaffMode("staff");
    refresh();
    return true;
  }, [refresh, state.hasPin]);

  const clearPin = useCallback(
    async (pin: string): Promise<boolean> => {
      setBusy(true);
      try {
        if (!(await checkPin(pin))) {
          setError("غلط PIN — PIN ہٹایا نہیں گیا۔");
          return false;
        }
        removePin();
        refresh("PIN ہٹا دیا گیا۔");
        return true;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const clearError = useCallback(() => setError(""), []);

  const mode: StaffMode = state.mode;
  return {
    hasPin: state.hasPin,
    mode,
    isStaff: mode === "staff",
    error,
    busy,
    clearError,
    savePin,
    unlock,
    lockOwner,
    clearPin,
  };
}

export type UseStaffLock = ReturnType<typeof useStaffLock>;
