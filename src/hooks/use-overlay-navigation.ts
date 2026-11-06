/**
 * Page-level overlay navigation.
 *
 * Every overlay on this single route used to be pushed onto history by hand and
 * closed from one `popstate` listener. That mechanic now lives here, together
 * with the state it drives, so the page only composes.
 *
 * Behaviour (open order, `activeView` priority, back-button closing) is
 * unchanged.
 */
import { useCallback, useEffect, useState } from "react";
import type { NavId } from "@/components/layout";
import type { ShopTab } from "@/features/shop";
import type { PinMode } from "@/components/sauti/StaffPinModal";
import type { EntryType } from "@/lib/khata";

export function useOverlayNavigation() {
  const [historyType, setHistoryType] = useState<EntryType | "balance" | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<ShopTab>("customers");
  const [navOpen, setNavOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode>("unlock");
  const [budgetDismissed, setBudgetDismissed] = useState(false);

  /* "balance" is not a sidebar entry — it is a ledger panel — so the highlight
     stays on the ledger. Income/expense are passed through as-is. */
  const activeView: NavId = shopOpen
    ? "shop"
    : analyticsOpen
      ? "analytics"
      : settingsOpen
        ? "settings"
        : historyType === "balance"
          ? "ledger"
          : (historyType ?? "ledger");

  const closeAll = useCallback(() => {
    setHistoryType(null);
    setAnalyticsOpen(false);
    setSettingsOpen(false);
    setShopOpen(false);
    setNavOpen(false);
  }, []);

  /* Every overlay is a history entry so the hardware/browser back button closes
     the overlay instead of leaving the app. */
  const pushOverlayHistory = useCallback(() => {
    window.history.pushState({ sautiOverlay: true }, "");
  }, []);

  useEffect(() => {
    function onPopState() {
      setHistoryType(null);
      setAnalyticsOpen(false);
      setSettingsOpen(false);
      setShopOpen(false);
      setNavOpen(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /** Sidebar / back-to-home. */
  const goHome = useCallback(() => {
    setHistoryType(null);
    setAnalyticsOpen(false);
    setSettingsOpen(false);
    setShopOpen(false);
    setNavOpen(false);
  }, []);

  const openLedgerPanel = useCallback(
    (type: EntryType | "balance") => {
      pushOverlayHistory();
      setHistoryType(type);
    },
    [pushOverlayHistory],
  );

  const openAnalytics = useCallback(() => {
    pushOverlayHistory();
    setAnalyticsOpen(true);
  }, [pushOverlayHistory]);

  const openExport = useCallback(() => {
    pushOverlayHistory();
    setExportOpen(true);
  }, [pushOverlayHistory]);

  const openShop = useCallback(
    (tab: ShopTab) => {
      pushOverlayHistory();
      setShopTab(tab);
      setShopOpen(true);
      setHistoryType(null);
      setAnalyticsOpen(false);
      setSettingsOpen(false);
      setNavOpen(false);
    },
    [pushOverlayHistory],
  );

  const openPin = useCallback(
    (mode: PinMode) => {
      setPinMode(mode);
      pushOverlayHistory();
      setPinOpen(true);
    },
    [pushOverlayHistory],
  );

  const openSettingsPanel = useCallback(() => {
    pushOverlayHistory();
    setSettingsOpen(true);
  }, [pushOverlayHistory]);

  /** Ledger/analytics/shop only; settings needs the panel's own resets. */
  const handleNavigate = useCallback(
    (id: NavId) => {
      if (id === "ledger") {
        goHome();
      } else if (id === "income" || id === "expense") {
        openLedgerPanel(id);
      } else if (id === "analytics") {
        openAnalytics();
      } else if (id === "shop") {
        openShop("customers");
      }
    },
    [goHome, openAnalytics, openLedgerPanel, openShop],
  );

  return {
    historyType,
    setHistoryType,
    analyticsOpen,
    setAnalyticsOpen,
    settingsOpen,
    setSettingsOpen,
    exportOpen,
    setExportOpen,
    shopOpen,
    setShopOpen,
    shopTab,
    setShopTab,
    navOpen,
    setNavOpen,
    pinOpen,
    setPinOpen,
    pinMode,
    setPinMode,
    budgetDismissed,
    setBudgetDismissed,
    activeView,
    closeAll,
    pushOverlayHistory,
    goHome,
    openLedgerPanel,
    openAnalytics,
    openExport,
    openShop,
    openPin,
    openSettingsPanel,
    handleNavigate,
  };
}
