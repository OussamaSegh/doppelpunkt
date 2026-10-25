import { describe, expect, it } from 'vitest';
import { diffWords, gswFold, levenshtein, normalize, sentenceKey, tokenize } from '../src';

describe('normalize', () => {
  it('trims, collapses whitespace and strips final punctuation', () => {
    expect(normalize('  Ich   bin  müde.  ')).toBe('ich bin müde');
    expect(normalize('Wie geht es?!')).toBe('wie geht es');
    expect(normalize('Ja …')).toBe('ja');
  });
  it('can keep final punctuation', () => {
    expect(normalize('Ja.', { stripFinalPunctuation: false })).toBe('ja.');
  });
  it('is case-insensitive by default and case-sensitive on request', () => {
    expect(normalize('Der Tisch')).toBe('der tisch');
    expect(normalize('Der Tisch', { caseSensitive: true })).toBe('Der Tisch');
  });
  it('unifies quotes and apostrophes', () => {
    expect(normalize('„Hallo“ «Tschüss» ‚ja‘ geht’s')).toBe('"hallo" "tschüss" \'ja\' geht\'s');
  });
  it('treats ß and ss as equal (Swiss spelling)', () => {
    expect(normalize('Straße')).toBe(normalize('Strasse'));
    expect(normalize('GROẞ', { caseSensitive: true })).toBe('GROSS');
  });
  it('umlaut fallback expands umlauts on both sides without breaking other words', () => {
    expect(normalize('Müller', { umlautFallback: true })).toBe(normalize('Mueller', { umlautFallback: true }));
    expect(normalize('Feuer', { umlautFallback: true })).toBe('feuer');
    expect(normalize('Müller')).not.toBe(normalize('Mueller'));
  });
  it('NFC-normalises decomposed umlauts', () => {
    expect(normalize('Müller')).toBe(normalize('Müller'));
  });
});

describe('tokens and keys', () => {
  it('ignores internal punctuation and apostrophes in sentence keys', () => {
    expect(sentenceKey('Ja, ich komme.')).toBe(sentenceKey('ja ich komme'));
    expect(sentenceKey("Wie geht's?")).toBe(sentenceKey('Wie gehts'));
  });
  it('drops punctuation-only tokens and keeps surface forms', () => {
    expect(tokenize('Hallo , Anna !').map((t) => t.surface)).toEqual(['Hallo', 'Anna']);
  });
});

describe('gswFold', () => {
  it('folds common Swiss German spelling variants', () => {
    expect(gswFold('Das choschtet vill')).toBe(gswFold('Das chostet vil'));
    expect(gswFold('Merci vielmal')).toBe(gswFold('Merci vilmal'));
    expect(gswFold('Grüezii')).toBe(gswFold('Grüezi'));
    expect(gswFold('Wy')).toBe(gswFold('Wii'));
    expect(gswFold('Chäs')).toBe(gswFold('Ches'));
  });
  it('keeps different words apart', () => {
    expect(gswFold('Grüezi')).not.toBe(gswFold('Grüessech'));
    expect(gswFold('isch')).toBe('isch');
  });
});

describe('levenshtein', () => {
  it('computes edit distance over code points', () => {
    expect(levenshtein('Hund', 'Hunt')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('schön', 'schon')).toBe(1);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('Schweiz', 'Schwiez')).toBe(2);
    expect(levenshtein('Schweiz', 'Schwiez', true)).toBe(1);
  });
});

describe('diffWords', () => {
  it('returns same tokens for equal texts regardless of case and punctuation', () => {
    const d = diffWords('Ich heisse Anna.', 'ich heisse anna');
    expect(d.every((t) => t.kind === 'same')).toBe(true);
    expect(d.map((t) => t.text)).toEqual(['Ich', 'heisse', 'Anna.']);
  });
  it('marks missing, extra and wrong words with surface forms', () => {
    expect(diffWords('Ich komme aus Bern', 'Ich komme von Bern heute')).toEqual([
      { text: 'Ich', kind: 'same' },
      { text: 'komme', kind: 'same' },
      { text: 'von', kind: 'wrong', expected: 'aus' },
      { text: 'Bern', kind: 'same' },
      { text: 'heute', kind: 'extra' },
    ]);
    expect(diffWords('Ich bin sehr müde', 'Ich bin müde')).toEqual([
      { text: 'Ich', kind: 'same' },
      { text: 'bin', kind: 'same' },
      { text: 'sehr', kind: 'missing' },
      { text: 'müde', kind: 'same' },
    ]);
  });
  it('treats Straße and Strasse as the same word', () => {
    expect(diffWords('die Straße', 'die Strasse').every((t) => t.kind === 'same')).toBe(true);
  });
  it('handles empty input', () => {
    expect(diffWords('', '')).toEqual([]);
    expect(diffWords('Hallo', '')).toEqual([{ text: 'Hallo', kind: 'missing' }]);
  });
});
