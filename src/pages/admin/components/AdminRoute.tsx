/**
 * Security guard for `/admin`.
 *
 * Deliberately *not* `RequireAuth`: the licence gate does not apply here (an
 * admin account holds no voucher), and a licence must never be what grants
 * admin. The only question this answers is "is the signed-in uid the hard-coded
 * admin uid?" — if not, the login screen.
 */
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { isAdminUid } from "@/lib/admin";

export function AdminRoute({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated || !isAdminUid(user?.uid)) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}
