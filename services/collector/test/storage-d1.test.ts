import { readFileSync } from 'node:fs';
import { ExportDump } from '@doppelpunkt/beta-schema';
import { describe, expect, it } from 'vitest';
import { buildExport, ingest, installHash, purge } from '../src/collector';
import { D1Storage } from '../src/storage-d1';
import { fakeD1 } from './fake-d1';
import { DAY, ENV, ID_A, ID_B, NOW, crash, feedback, stats } from './helpers';

const schema = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
const db = await fakeD1(schema);

// Runs the real migration and SQL against SQLite when node:sqlite exists (Node 22.5+).
describe.skipIf(!db)('D1Storage (migration + SQL on SQLite)', () => {
  it('stores, aggregates, exports, forgets and purges', async () => {
    const storage = new D1Storage(db!);
    const opts = { installSecret: ENV.INSTALL_SECRET, now: NOW };
    expect(await ingest(storage, [feedback({ comment: 'hm' }), crash({ stack: undefined }), stats(), stats({ installId: ID_B, band: undefined }), stats()], opts)).toEqual({ accepted: 5, rejected: 0 });
    await ingest(storage, [stats({ day: '2026-10-28' })], { ...opts, now: NOW + 7 * DAY });

    const dump = ExportDump.parse(await buildExport(storage, { now: NOW + 7 * DAY }));
    expect(dump.feedback).toEqual([feedback({ comment: 'hm' })]);
    expect(dump.crashes).toEqual([crash({ stack: undefined })]);
    const a1 = dump.stats.find((s) => s.day === '2026-10-21' && s.band === 'A1')!;
    expect(a1.items).toEqual([{ itemId: 'a1-u01-ex03', attempts: 6, buckets: [2, 0, 2], seconds: 80 }]);
    expect(dump.stats.find((s) => s.day === '2026-10-21' && s.band === undefined)).toBeTruthy();
    expect(dump.retention).toEqual([{ cohortWeek: '2026-W43', installs: 2, activeWeek: [1, 0, 0, 0] }]);

    expect(await storage.deleteInstall(await installHash(ID_A, ENV.INSTALL_SECRET))).toBe(true);
    expect((await storage.listInstalls()).length).toBe(1);

    expect(await purge(storage, NOW + 400 * DAY)).toEqual({ crashes: 1, feedback: 1, installs: 1 });
    expect((await storage.listStats('0000-01-01')).length).toBe(3);
  });
});
