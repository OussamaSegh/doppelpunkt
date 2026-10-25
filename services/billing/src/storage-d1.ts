/**
 * D1 implementation of Storage. Minimal structural D1 types are declared here so the package
 * doesn't need @cloudflare/workers-types; the real D1Database satisfies them.
 */
import type { CodeRow, PurchaseRow, Storage } from './storage';

export interface D1Result {
  results?: unknown[];
  meta?: { changes?: number };
}
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  run(): Promise<D1Result>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface D1Like {
  prepare(sql: string): D1Stmt;
}

type PurchaseDb = {
  pid: string;
  source: string;
  sku: string;
  session_id: string | null;
  payment_intent: string | null;
  email_hash: string | null;
  code_hash: string | null;
  token: string;
  status: string;
  created_at: number;
};

type CodeDb = { hash: string; book: string; max_uses: number; uses: number; batch: string; revoked: number; created_at: number };

const opt = (v: string | null) => v ?? undefined;

function purchase(r: PurchaseDb | null): PurchaseRow | null {
  if (!r) return null;
  return {
    pid: r.pid,
    source: r.source === 'code' ? 'code' : 'checkout',
    sku: r.sku,
    sessionId: opt(r.session_id),
    paymentIntent: opt(r.payment_intent),
    emailHash: opt(r.email_hash),
    codeHash: opt(r.code_hash),
    token: r.token,
    status: r.status === 'refunded' ? 'refunded' : 'paid',
    createdAt: Number(r.created_at),
  };
}

export class D1Storage implements Storage {
  constructor(private readonly db: D1Like) {}

  async getPurchase(pid: string) {
    return purchase(await this.db.prepare('SELECT * FROM purchases WHERE pid = ?').bind(pid).first<PurchaseDb>());
  }

  async getPurchaseBySession(sessionId: string) {
    return purchase(await this.db.prepare('SELECT * FROM purchases WHERE session_id = ?').bind(sessionId).first<PurchaseDb>());
  }

  async insertPurchase(row: PurchaseRow) {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO purchases (pid, source, sku, session_id, payment_intent, email_hash, code_hash, token, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.pid, row.source, row.sku, row.sessionId ?? null, row.paymentIntent ?? null, row.emailHash ?? null, row.codeHash ?? null, row.token, row.status, row.createdAt)
      .run();
    const stored = row.sessionId ? await this.getPurchaseBySession(row.sessionId) : await this.getPurchase(row.pid);
    return stored ?? row;
  }

  async setStatusByPaymentIntent(paymentIntent: string, status: PurchaseRow['status']) {
    const r = await this.db.prepare('UPDATE purchases SET status = ? WHERE payment_intent = ? AND status <> ?').bind(status, paymentIntent, status).run();
    return Number(r.meta?.changes ?? 0);
  }

  async getCode(hash: string): Promise<CodeRow | null> {
    const r = await this.db.prepare('SELECT * FROM book_codes WHERE hash = ?').bind(hash).first<CodeDb>();
    if (!r) return null;
    return { hash: r.hash, book: r.book, maxUses: Number(r.max_uses), uses: Number(r.uses), batch: r.batch, revoked: !!r.revoked, createdAt: Number(r.created_at) };
  }

  async takeCodeUse(hash: string) {
    const r = await this.db.prepare('UPDATE book_codes SET uses = uses + 1 WHERE hash = ? AND revoked = 0 AND uses < max_uses').bind(hash).run();
    return Number(r.meta?.changes ?? 0) === 1;
  }

  async releaseCodeUse(hash: string) {
    await this.db.prepare('UPDATE book_codes SET uses = uses - 1 WHERE hash = ? AND uses > 0').bind(hash).run();
  }

  async putCode(row: CodeRow) {
    await this.db
      .prepare('INSERT OR REPLACE INTO book_codes (hash, book, max_uses, uses, batch, revoked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(row.hash, row.book, row.maxUses, row.uses, row.batch, row.revoked ? 1 : 0, row.createdAt)
      .run();
  }
}
