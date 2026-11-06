/**
 * Cloud settings panel state: the AI key draft, the upload confirmation and the
 * upload/download pair.
 *
 * Behaviour is intentionally identical to the previous inline handlers: the
 * panel is closed by `closePanel` in exactly the same places, the status text
 * passed to the toast is the value captured at render time (as before), and
 * download keeps its original single call.
 */
import { useCallback, useState } from "react";
import { LEGACY_API_KEY_STORAGE, type Entry } from "@/lib/khata";
import { t } from "@/lib/i18n";
import { notifySuccess, notifyWarning } from "@/lib/notifications";

export type UseCloudSettingsOptions = {
  isAuthenticated: boolean;
  hasCloudKey: boolean;
  status: string;
  setStatus: (status: string) => void;
  saveGeminiKey: (key: string) => Promise<boolean>;
  upload: () => Promise<boolean>;
  download: () => { income: Entry[]; expense: Entry[] } | null;
  replaceAll: (income: Entry[], expense: Entry[]) => void;
  onBackedUp: () => void;
  resetImportMsg: () => void;
  speak: (text: string) => void;
  closePanel: () => void;
};

export function useCloudSettings({
  isAuthenticated,
  hasCloudKey,
  status,
  setStatus,
  saveGeminiKey,
  upload,
  download,
  replaceAll,
  onBackedUp,
  resetImportMsg,
  speak,
  closePanel,
}: UseCloudSettingsOptions) {
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);

  /** Settings-specific resets; the navigation layer opens the panel itself. */
  const preparePanel = useCallback(() => {
    localStorage.removeItem(LEGACY_API_KEY_STORAGE);
    setApiKeyDraft(hasCloudKey ? "••••••••" : "");
    resetImportMsg();
    setStatus("");
  }, [hasCloudKey, resetImportMsg, setStatus]);

  const saveApiKey = useCallback(async () => {
    const key = apiKeyDraft.trim();
    if (!key || key === "••••••••") {
      closePanel();
      return;
    }
    if (!isAuthenticated) {
      setStatus(t("aiKeyNeedsConnection"));
      closePanel();
      return;
    }
    const ok = await saveGeminiKey(key);
    localStorage.removeItem(LEGACY_API_KEY_STORAGE);
    closePanel();
    if (ok) speak(t("aiKeySavedVoice"));
  }, [apiKeyDraft, closePanel, isAuthenticated, saveGeminiKey, setStatus, speak]);

  const handleUpload = useCallback(async () => {
    if (!isAuthenticated) {
      setStatus("کلاؤڈ سینک کے لیے آن لائن شناخت درکار ہے۔");
      return;
    }
    const ok = await upload();
    if (ok) {
      onBackedUp();
      notifySuccess("کلاؤڈ سینک محفوظ ہو گئی", status);
    } else {
      notifyWarning("سینک مکمل نہیں ہو سکی", status);
    }
  }, [isAuthenticated, onBackedUp, setStatus, status, upload]);

  const handleDownload = useCallback(() => {
    const pulled = download();
    if (pulled) replaceAll(pulled.income, pulled.expense);
  }, [download, replaceAll]);

  return {
    apiKeyDraft,
    setApiKeyDraft,
    uploadConfirmOpen,
    setUploadConfirmOpen,
    preparePanel,
    saveApiKey,
    handleUpload,
    handleDownload,
  };
}
