/**
 * Minimal D1 stand-in over node:sqlite (Node 22.5+): prepare/bind/run/first. Lets the tests run the
 * real migration and the real SQL. Returns null where node:sqlite is missing.
 */
import type { D1Like } from '../src/storage-d1';

interface SqliteStatement { run(...p: unknown[]): { changes: number | bigint }; get(...p: unknown[]): unknown }
interface SqliteDb { exec(sql: string): void; prepare(sql: string): SqliteStatement }

export async function fakeD1(schema: string): Promise<D1Like | null> {
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
      return { results: [], meta: { changes: Number(r.changes) } };
    }
    async first<T>() {
      const r = db.prepare(this.sql).get(...this.params);
      return (r ? { ...(r as object) } : null) as T | null;
    }
  }
  return { prepare: (sql: string) => new Stmt(sql) };
}
