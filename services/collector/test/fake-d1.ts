/**
 * Minimal D1 adapter over node:sqlite (Node 22.5+), just enough for D1Storage: prepare/bind/run/all/first
 * and batch. Lets the tests run the real migration and the real SQL. Returns null where node:sqlite is missing.
 */
interface SqliteStatement { run(...p: unknown[]): { changes: number | bigint }; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown }
interface SqliteDb { exec(sql: string): void; prepare(sql: string): SqliteStatement }

export async function fakeD1(schema: string): Promise<D1Database | null> {
  let mod: { DatabaseSync: new (path: string) => SqliteDb };
  try {
    const name = 'node:sqlite';
    mod = await import(/* @vite-ignore */ name);
  } catch {
    return null;
  }
  const db = new mod.DatabaseSync(':memory:');
  db.exec(schema);

  class Stmt {
    constructor(readonly sql: string, readonly params: unknown[] = []) {}
    bind(...params: unknown[]) {
      return new Stmt(this.sql, params);
    }
    async run() {
      const r = db.prepare(this.sql).run(...this.params);
      return { success: true, results: [], meta: { changes: Number(r.changes) } };
    }
    async all() {
      return { success: true, results: db.prepare(this.sql).all(...this.params).map((r) => ({ ...(r as object) })), meta: {} };
    }
    async first() {
      const r = db.prepare(this.sql).get(...this.params);
      return r ? { ...(r as object) } : null;
    }
  }

  const fake = {
    prepare: (sql: string) => new Stmt(sql),
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return fake as unknown as D1Database;
}
