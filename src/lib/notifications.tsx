/** Small notification helpers used by the rest of the app. */
import { toast } from "sonner";

type Notice = {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive" | "warning";
  duration?: number;
};

export function useNotifications() {
  return {
    notifySuccess,
    notifyDanger,
    notifyWarning,
    safeStatusMessage,
  };
}

/*
 * These used to build a `Notice` object and throw it away, so a “backup saved”
 * message never appeared. They now raise a sonner toast (the `<Toaster />` is
 * mounted in main.tsx) and still return the object for callers that want it.
 */
export function notifySuccess(title: string, description?: string): Notice {
  toast.success(title, { description, duration: 4500 });
  return { title, description, variant: "success" };
}

export function notifyDanger(title: string, description?: string): Notice {
  toast.error(title, { description, duration: 6000 });
  return { title, description, variant: "destructive" };
}

export function notifyWarning(title: string, description?: string): Notice {
  toast.warning(title, { description, duration: 5000 });
  return { title, description, variant: "warning" };
}

/** Safe wrapper around optional text so status lines never look broken. */
export function safeStatusMessage(status: string | null | undefined): string | null {
  return status && status.trim().length > 0 ? status.trim() : null;
}
