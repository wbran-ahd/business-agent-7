import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Recurring incomes used to be applied by whichever browser happened to open
 * the app, which meant a month could be missed (or double-applied on a second
 * device). They are now materialised on the server, idempotently, once a day —
 * the client still triggers the same mutation on load so an active user sees
 * the entry immediately.
 */
crons.daily(
  "materialise recurring incomes",
  { hourUTC: 0, minuteUTC: 3 },
  internal.sync.applyRecurringAll,
  {},
);

export default crons;
