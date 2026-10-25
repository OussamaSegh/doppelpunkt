import type { CodeRow, PurchaseRow, Storage } from './storage';

/** In-memory storage for tests and local experiments. Not shared between isolates. */
export class MemoryStorage implements Storage {
  readonly purchases = new Map<string, PurchaseRow>();
  readonly codes = new Map<string, CodeRow>();

  async getPurchase(pid: string) {
    return this.purchases.get(pid) ?? null;
  }

  async getPurchaseBySession(sessionId: string) {
    for (const p of this.purchases.values()) if (p.sessionId === sessionId) return p;
    return null;
  }

  async insertPurchase(row: PurchaseRow) {
    const existing = this.purchases.get(row.pid) ?? (row.sessionId ? await this.getPurchaseBySession(row.sessionId) : null);
    if (existing) return existing;
    this.purchases.set(row.pid, { ...row });
    return row;
  }

  async setStatusByPaymentIntent(paymentIntent: string, status: PurchaseRow['status']) {
    let n = 0;
    for (const p of this.purchases.values()) {
      if (p.paymentIntent === paymentIntent && p.status !== status) {
        p.status = status;
        n++;
      }
    }
    return n;
  }

  async getCode(hash: string) {
    return this.codes.get(hash) ?? null;
  }

  async takeCodeUse(hash: string) {
    const c = this.codes.get(hash);
    if (!c || c.revoked || c.uses >= c.maxUses) return false;
    c.uses++;
    return true;
  }

  async releaseCodeUse(hash: string) {
    const c = this.codes.get(hash);
    if (c && c.uses > 0) c.uses--;
  }

  async putCode(row: CodeRow) {
    this.codes.set(row.hash, { ...row });
  }
}
