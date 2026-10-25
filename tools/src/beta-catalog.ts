// Every item the app can report statistics or feedback for, with the file a content author edits.
// Item ids follow the app:
// - unit exercises and mock-exam exercises: the exercise `id`;
// - pronunciation drills (apps/web/src/lib/pronunciation.ts): `pron-<drill>-pair-<n>` (n = 2 × pair
//   index + side), `pron-<drill>-word-<i>`, `pron-<drill>-sentence-<i>`, and the minimal-pair quiz
//   (engine minimalPairQuiz) `<drill>-mp-<pair index>-<a|b>`.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LEVELS, type Level } from '@doppelpunkt/content-schema';
import { drillUnitId } from '@doppelpunkt/engine';
import { loadExams } from './exam';
import { loadContent, UNIT_FILES } from './load';
import { loadDrills } from './pronunciation';

export type ItemKind = 'unit' | 'exam' | 'drill';

export type CatalogItem = {
  itemId: string;
  kind: ItemKind;
  /** Exercise type, or `speak` / `minimal-pair` for drill items. */
  type: string;
  skill: string;
  variety: string;
  level: Level;
  /** Unit id, exam id or `pron-<drill id>` (the group in the unit summary). */
  groupId: string;
  groupTitle: string;
  /** Position in the course: level × 100 + unit number (exams 50, drills 0). */
  rank: number;
  /** YAML file relative to the repo root, and the 1-based line of the item where it was found. */
  file: string;
  line?: number;
};

export type Catalog = { items: Map<string, CatalogItem>; groups: Array<{ id: string; title: string; kind: ItemKind; rank: number; file: string }> };

/** Course position: level × 100 + unit number. */
export const rankOf = (level: Level, unit: number) => LEVELS.indexOf(level) * 100 + unit;

function lineFinder(file: string): (needle: RegExp) => number | undefined {
  let lines: string[] | undefined;
  return (needle) => {
    try {
      lines ??= readFileSync(file, 'utf8').split('\n');
    } catch {
      return undefined;
    }
    const i = lines.findIndex((l) => needle.test(l));
    return i >= 0 ? i + 1 : undefined;
  };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idLine = (id: string) => new RegExp(`^\\s*-?\\s*id:\\s*["']?${esc(id)}["']?\\s*(#.*)?$`);

/** Load units, exams and drills under `contentDir`; paths are made relative to `root`. Invalid files are skipped. */
export function loadCatalog(contentDir: string, root: string): Catalog {
  const items = new Map<string, CatalogItem>();
  const groups: Catalog['groups'] = [];
  const add = (it: CatalogItem) => { if (!items.has(it.itemId)) items.set(it.itemId, it); };

  for (const lu of loadContent(contentDir, root).units) {
    const abs = join(lu.dir, UNIT_FILES.exercises);
    const file = relative(root, abs);
    const find = lineFinder(abs);
    const rank = rankOf(lu.level, lu.number);
    groups.push({ id: lu.unit.id, title: lu.unit.title, kind: 'unit', rank, file });
    for (const e of lu.unit.exercises) {
      add({ itemId: e.id, kind: 'unit', type: e.type, skill: e.skill, variety: e.variety, level: lu.level, groupId: lu.unit.id, groupTitle: lu.unit.title, rank, file, line: find(idLine(e.id)) });
    }
  }
  for (const le of loadExams(contentDir, root).exams) {
    const file = relative(root, le.file);
    const find = lineFinder(le.file);
    const rank = rankOf(le.level, 50);
    groups.push({ id: le.exam.id, title: le.exam.title, kind: 'exam', rank, file });
    for (const s of le.exam.sections) {
      for (const e of s.exercises) {
        add({ itemId: e.id, kind: 'exam', type: e.type, skill: e.skill, variety: e.variety, level: le.level, groupId: le.exam.id, groupTitle: le.exam.title, rank, file, line: find(idLine(e.id)) });
      }
    }
  }
  for (const ld of loadDrills(contentDir, root).drills) {
    const d = ld.drill;
    const file = relative(root, ld.file);
    const find = lineFinder(ld.file);
    const groupId = drillUnitId(d.id);
    const rank = rankOf(d.level, 0);
    groups.push({ id: groupId, title: d.title, kind: 'drill', rank, file });
    const base = { kind: 'drill' as const, variety: d.variety, level: d.level, groupId, groupTitle: d.title, rank, file };
    const textLine = (text: string) => find(new RegExp(`text:\\s*["']?${esc(text)}["']?\\s*[,}]?`));
    d.pairs.forEach((pair, i) => {
      pair.forEach((w, side) => add({ ...base, itemId: `${groupId}-pair-${i * 2 + side}`, type: 'speak', skill: 'speaking', line: textLine(w.text) }));
      (['a', 'b'] as const).forEach((s, side) => add({ ...base, itemId: `${d.id}-mp-${i}-${s}`, type: 'minimal-pair', skill: 'listening', line: textLine(pair[side]!.text) }));
    });
    d.words.forEach((w, i) => add({ ...base, itemId: `${groupId}-word-${i}`, type: 'speak', skill: 'speaking', line: textLine(w.text) }));
    d.sentences.forEach((w, i) => add({ ...base, itemId: `${groupId}-sentence-${i}`, type: 'speak', skill: 'speaking', line: textLine(w.text) }));
  }
  const kindOrder: Record<ItemKind, number> = { unit: 0, exam: 1, drill: 2 };
  groups.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.rank - b.rank || a.id.localeCompare(b.id));
  return { items, groups };
}
