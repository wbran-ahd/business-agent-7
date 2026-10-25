import { useAuth } from "@/hooks/use-auth";
import { useLicense } from "@/hooks/use-license";
import { Loader2 } from "lucide-react";
import { Navigate } from "react-router";
import type { ReactNode } from "react";

/**
 * Route gate for the signed-in product.
 *
 * Access to صوتی بقیہ is QR/activation-code only, so this gate never sends
 * anyone to a sign-in form. It waits for Firebase's anonymous identity (which
 * `use-license` starts) and for that uid's licence answer:
 *
 * - identity not ready / licence still loading → spinner
 * - no identity → `/activate` (never a blank screen: the activation screen is
 *   the entry point, so it stays reachable without a session)
 * - definitively unlicensed (`missing`, `expired`, `revoked`) → `/activate`
 * - network failure or rate limit → let the app through: local-first, and
 *   Firestore rules still enforce the licence server-side.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const { phase } = useLicense();

  if (isLoading || phase === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  // Previously this returned `null`, which painted a blank page whenever the
  // anonymous session was still missing (e.g. Firebase sign-in blocked) — the
  // white screen the audit carried as #5. RedirectTo /activate now.
  if (!isAuthenticated) {
    return <Navigate to="/activate" replace />;
  }

  if (phase === "missing" || phase === "expired" || phase === "revoked") {
    return <Navigate to="/activate" replace />;
  }

  return children;
}
