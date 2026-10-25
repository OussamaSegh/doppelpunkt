// Minimal, formatting-preserving YAML edits. The `yaml` Document API locates the target map and
// its source ranges; the change is spliced into the original text so comments, folded scalars,
// flow maps and blank lines stay exactly as the author wrote them. Re-stringifying the whole
// document would reflow long strings.
import { isDeepStrictEqual } from 'node:util';
import { isMap, isScalar, parseDocument, type Pair, type YAMLMap } from 'yaml';

/** Render a string as a YAML scalar: plain when that round-trips, otherwise double-quoted. */
export function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_./-][A-Za-z0-9_./ -]*$/.test(value) && !/\s$/.test(value)) {
    const back = parseDocument(`k: ${value}`).toJS() as { k: unknown };
    if (back.k === value) return value;
  }
  return JSON.stringify(value);
}

function setIn(obj: unknown, path: Array<string | number>, value: unknown): unknown {
  if (!path.length) return value;
  const [head, ...rest] = path;
  if (Array.isArray(obj)) {
    const copy = [...obj];
    copy[head as number] = setIn(copy[head as number], rest, value);
    return copy;
  }
  const o = (obj ?? {}) as Record<string, unknown>;
  return { ...o, [head as string]: setIn(o[head as string], rest, value) };
}

const lineCol = (src: string, at: number) => at - (src.lastIndexOf('\n', at - 1) + 1);

/**
 * Set the string at `pointer` (path of map keys / sequence indexes; the last segment is a map key)
 * and return the new source. Throws if the parent is not a map or the edit would change anything else.
 */
export function setYamlString(src: string, pointer: Array<string | number>, value: string): string {
  const doc = parseDocument(src);
  if (doc.errors.length) throw new Error(`YAML: ${doc.errors[0]!.message}`);
  const key = pointer[pointer.length - 1];
  if (typeof key !== 'string') throw new Error('the last pointer segment must be a map key');
  const parent = pointer.length > 1 ? doc.getIn(pointer.slice(0, -1), true) : doc.contents;
  if (!isMap(parent) || !parent.range) throw new Error(`no map at ${pointer.slice(0, -1).join('.')}`);
  const map = parent as YAMLMap;
  const lit = yamlScalar(value);
  const pairs = map.items as Pair[];
  const existing = pairs.find((p) => isScalar(p.key) && p.key.value === key);
  let out: string;

  if (existing && isScalar(existing.value) && existing.value.range) {
    const [s, e] = existing.value.range;
    out = src.slice(0, s) + lit + src.slice(e);
  } else if (existing) {
    throw new Error(`${pointer.join('.')} exists but is not a scalar`);
  } else if (map.flow) {
    const close = src.lastIndexOf('}', map.range![1]);
    let at = close;
    while (at > 0 && /\s/.test(src[at - 1]!)) at--;
    out = src.slice(0, at) + (pairs.length ? ', ' : ' ') + `${key}: ${lit}` + (pairs.length ? '' : ' ') + src.slice(at);
  } else {
    // Insert after the last pair whose value sits on one line (not a block scalar or nested block).
    const single = pairs.filter((p) => {
      const k = p.key as { range?: [number, number, number] } | null;
      const v = p.value as { range?: [number, number, number] } | null;
      return k?.range && v?.range && !src.slice(k.range[0], v.range[1]).includes('\n') && !/^[|>]/.test(src.slice(v.range[0], v.range[1]));
    });
    const anchor = single[single.length - 1];
    const first = pairs[0]?.key as { range?: [number, number, number] } | null | undefined;
    if (anchor) {
      const k = (anchor.key as { range: [number, number, number] }).range;
      const v = (anchor.value as { range: [number, number, number] }).range;
      const eol = src.indexOf('\n', v[1]);
      const at = eol < 0 ? src.length : eol;
      out = src.slice(0, at) + `\n${' '.repeat(lineCol(src, k[0]))}${key}: ${lit}` + src.slice(at);
    } else if (first?.range) {
      // Only multi-line entries (e.g. `text: |` block scalars): put the new key first.
      const at = first.range[0];
      out = src.slice(0, at) + `${key}: ${lit}\n${' '.repeat(lineCol(src, at))}` + src.slice(at);
    } else {
      throw new Error(`no entry to anchor the new key at ${pointer.join('.')}`);
    }
  }

  const check = parseDocument(out);
  if (check.errors.length || !isDeepStrictEqual(check.toJS(), setIn(doc.toJS(), pointer, value))) {
    throw new Error(`could not set ${pointer.join('.')} without changing other content`);
  }
  return out;
}
