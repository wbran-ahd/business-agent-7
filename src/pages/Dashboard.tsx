import KhataApp from "./KhataApp";

/**
 * صوتی بقیہ — the voice ledger, and the app's entry point.
 *
 * `main.tsx` mounts this at `/`, so opening the app lands straight in the
 * workspace (sidebar, ledger panel, analytics and settings).
 */
export default function Dashboard() {
  return <KhataApp />;
}
