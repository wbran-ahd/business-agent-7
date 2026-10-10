/** Small notification helpers used by the rest of the app. */

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

export function notifySuccess(title: string, description?: string): Notice {
  return { title, description, variant: "success" };
}

export function notifyDanger(title: string, description?: string): Notice {
  return { title, description, variant: "destructive" };
}

export function notifyWarning(title: string, description?: string): Notice {
  return { title, description, variant: "warning" };
}

/** Safe wrapper around optional text so status lines never look broken. */
export function safeStatusMessage(status: string | null | undefined): string | null {
  return status && status.trim().length > 0 ? status.trim() : null;
}
