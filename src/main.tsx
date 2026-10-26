import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import {
  RouteLoading,
  RouteSyncer,
  RootErrorBoundary,
  ToolbarErrorBoundary,
} from "@/components/RoutePrimitives";
import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
// Self-hosted fonts first, so the @font-face rules exist before the theme CSS.
import "./styles/fonts.css";
import "./index.css";

// Optional observability. Both are silent no-ops until .env has a DSN/key, and
// neither renders anything — the UI is untouched. Audit #32: they no longer sit
// in the synchronous boot path; each bundle loads itself after first paint and
// initialises then, so the ledger paints first even on a slow phone.
initObservability();

function initObservability() {
  const afterPaint = () => {
    void import("@/lib/sentry").then((module) => module.initSentry());
    void import("@/lib/analytics").then((module) => module.initAnalytics());
  };
  if (typeof window !== "undefined" && window.requestAnimationFrame) {
    // Double rAF === after first paint, before user input settles.
    window.requestAnimationFrame(() => window.requestAnimationFrame(afterPaint));
  } else {
    setTimeout(afterPaint, 0);
  }
}

// Lazy load route components for better code splitting
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// روٹ لوڈنگ فال بیک، error boundaries اور RouteSyncer اب RoutePrimitives.tsx
// میں ہیں — یہ فائل صرف روٹس اور نیویگیشن وائرنگ رکھتی ہے
// (react-refresh/only-export-components کا اصل حل، آڈٹ #15)۔

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <BrowserRouter>
        <RouteSyncer />
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            {/* The ledger is the entry point: no activation screen, no gate. */}
            <Route path="/" element={<Dashboard />} />
            {/* Kept so old links, bookmarks and the PWA shortcut still land. */}
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster />
    </RootErrorBoundary>
  </StrictMode>,
);
