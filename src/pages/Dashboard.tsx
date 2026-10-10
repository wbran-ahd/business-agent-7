import KhataApp from "./KhataApp";

/**
 * The authenticated product: صوتی بقیہ — the voice ledger.
 *
 * `RequireAuth` in `main.tsx` guards this route, so everyone who reaches it is
 * signed in and lands straight in the workspace (sidebar, ledger panel,
 * analytics and settings) rather than on placeholder copy.
 */
export default function Dashboard() {
  return <KhataApp />;
}
