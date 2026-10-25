/**
 * Storage interface of the billing Worker. src/billing.ts only talks to this; src/storage-d1.ts is
 * the D1 mapping (columns: migrations/0001_init.sql) and src/storage-memory.ts is for tests and
 * `wrangler dev` without a database.
 */

export interface PurchaseRow {
  pid: string;
  source: 'checkout' | 'code';
  sku: string;
  sessionId?: string;
  paymentIntent?: string;
  emailHash?: string;
  codeHash?: string;
  token: string;
  status: 'paid' | 'refunded';
  createdAt: number;
}

export interface CodeRow {
  hash: string;
  book: string;
  maxUses: number;
  uses: number;
  batch: string;
  revoked: boolean;
  createdAt: number;
}

export interface Storage {
  getPurchase(pid: string): Promise<PurchaseRow | null>;
  getPurchaseBySession(sessionId: string): Promise<PurchaseRow | null>;
  /** Inserts unless a row with the same pid or session id exists. Returns the stored row. */
  insertPurchase(row: PurchaseRow): Promise<PurchaseRow>;
  /** Marks every purchase of this PaymentIntent; returns how many rows changed. */
  setStatusByPaymentIntent(paymentIntent: string, status: PurchaseRow['status']): Promise<number>;

  getCode(hash: string): Promise<CodeRow | null>;
  /** Atomically counts one use if the code exists, isn't revoked and has uses left. */
  takeCodeUse(hash: string): Promise<boolean>;
  /** Gives a use back (when issuing the token failed after takeCodeUse). */
  releaseCodeUse(hash: string): Promise<void>;
  putCode(row: CodeRow): Promise<void>;
}
