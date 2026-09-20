import "server-only";
import type { Entitlement } from "@/engine/enhance/costGate";

/**
 * Credit ledger. Designed for credits and one-off purchases (spec §13) — NOT subscriptions.
 * MVP ships an in-memory implementation with no sign-in, so every visitor is anonymous and
 * full-resolution enhancement is always refused by the cost gate. A persistent store (Postgres,
 * etc.) implements the same interface when payments are added.
 */
export interface LedgerEntry {
  id: string;
  userId: string;
  delta: number;
  reason: "purchase" | "enhancement" | "refund" | "grant";
  jobId?: string;
  at: string;
}

export interface CreditStore {
  entitlement(sessionId: string | null, userId: string | null): Promise<Entitlement>;
  /** Atomically reserve credits for a job; returns false if the balance is insufficient. */
  reserve(userId: string, credits: number, jobId: string): Promise<boolean>;
  /** Return reserved credits if a job fails (failures are never charged). */
  refund(userId: string, credits: number, jobId: string): Promise<void>;
  consumePreview(sessionId: string): Promise<void>;
}

const FREE_PREVIEWS_PER_SESSION = 3;

export class MemoryCreditStore implements CreditStore {
  private balances = new Map<string, number>();
  private previews = new Map<string, number>();
  readonly ledger: LedgerEntry[] = [];

  async entitlement(sessionId: string | null, userId: string | null): Promise<Entitlement> {
    const used = sessionId ? this.previews.get(sessionId) ?? 0 : FREE_PREVIEWS_PER_SESSION;
    return {
      userId,
      anonymous: !userId,
      credits: userId ? this.balances.get(userId) ?? 0 : 0,
      freePreviewsRemaining: Math.max(0, FREE_PREVIEWS_PER_SESSION - used),
    };
  }

  async reserve(userId: string, credits: number, jobId: string): Promise<boolean> {
    const bal = this.balances.get(userId) ?? 0;
    if (bal < credits) return false;
    this.balances.set(userId, bal - credits);
    this.ledger.push({ id: crypto.randomUUID(), userId, delta: -credits, reason: "enhancement", jobId, at: new Date().toISOString() });
    return true;
  }

  async refund(userId: string, credits: number, jobId: string): Promise<void> {
    this.balances.set(userId, (this.balances.get(userId) ?? 0) + credits);
    this.ledger.push({ id: crypto.randomUUID(), userId, delta: credits, reason: "refund", jobId, at: new Date().toISOString() });
  }

  async consumePreview(sessionId: string): Promise<void> {
    this.previews.set(sessionId, (this.previews.get(sessionId) ?? 0) + 1);
  }
}

const g = globalThis as unknown as { __printreadyCredits?: CreditStore };
export const credits: CreditStore = (g.__printreadyCredits ??= new MemoryCreditStore());
