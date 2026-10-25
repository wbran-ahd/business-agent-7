/**
 * Append-only audit trail.
 *
 * `audit_log` is admin-readable and client-unwritable (see `firestore.rules`),
 * so a lost phone can always be traced back to the code that activated it.
 * Auditing is best-effort: a failure here must never swallow the real error
 * the caller is about to throw.
 */
import { type Firestore } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";
import { type ActorRole, type AuditAction, type AuditDoc } from "./types";

export interface AuditInput {
  action: AuditAction;
  ok: boolean;
  actorUid: string;
  actorRole: ActorRole;
  actorIp?: string | null;
  targetUid?: string | null;
  codeId?: string | null;
  detail: string;
}

const DETAIL_MAX = 300;

export async function writeAudit(
  db: Firestore,
  entry: AuditInput,
): Promise<void> {
  const doc: AuditDoc = {
    action: entry.action,
    ok: entry.ok,
    actor_uid: entry.actorUid,
    actor_role: entry.actorRole,
    actor_ip: entry.actorIp ?? null,
    target_uid: entry.targetUid ?? null,
    code_id: entry.codeId ?? null,
    detail: entry.detail.slice(0, DETAIL_MAX),
    at: Date.now(),
  };
  try {
    await db.collection("audit_log").add(doc);
  } catch {
    // Logging must not mask the outcome of the call itself.
  }
}

/** First hop of `x-forwarded-for`, else null — used for rate limiting + audit. */
export function requestIp(request: CallableRequest<unknown>): string | null {
  const headers = request.rawRequest.headers;
  const forwarded = firstHeader(headers["x-forwarded-for"]);
  if (forwarded) return forwarded.split(",")[0]!.trim() || null;
  return firstHeader(headers["x-appengine-user-ip"]);
}

function firstHeader(value: string | string[] | undefined): string | null {
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed : null;
}
