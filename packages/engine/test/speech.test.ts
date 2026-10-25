import { describe, expect, it } from 'vitest';
import { grade, gradeSpeech, numberKey, pronunciationIssues, SPEAK_PASS, SPEECH_NEAR_CREDIT } from '../src';
import { ex } from './helpers';

const ids = (r: ReturnType<typeof gradeSpeech>) => (r.hints ?? []).map((h) => h.id);

describe('numberKey', () => {
  it('maps German number words 0–100 to digits', () => {
    expect(numberKey('null')).toBe('0');
    expect(numberKey('drei')).toBe('3');
    expect(numberKey('Zwölf')).toBe('12');
    expect(numberKey('zwanzig')).toBe('20');
    expect(numberKey('einundzwanzig')).toBe('21');
    expect(numberKey('siebenundvierzig')).toBe('47');
    expect(numberKey('neunundneunzig')).toBe('99');
    expect(numberKey('dreißig')).toBe('30');
    expect(numberKey('dreissig')).toBe('30');
    expect(numberKey('fuenfundfuenfzig')).toBe('55');
    expect(numberKey('hundert')).toBe('100');
    expect(numberKey('007')).toBe('7');
  });
  it('leaves other words alone; ein is an article', () => {
    expect(numberKey('Kaffee')).toBe('Kaffee');
    expect(numberKey('ein')).toBe('ein');
    expect(numberKey('eins')).toBe('1');
  });
  it('knows Swiss German numbers only for Swiss varieties', () => {
    expect(numberKey('drü', true)).toBe('3');
    expect(numberKey('zwänzg', true)).toBe('20');
    expect(numberKey('drü')).toBe('drü');
  });
});

describe('gradeSpeech: ASR artefacts', () => {
  it('accepts a perfect transcript without case or punctuation', () => {
    const r = gradeSpeech('Ich hätte gern einen Kaffee, bitte.', 'ich hätte gern einen kaffee bitte');
    expect(r).toMatchObject({ correct: true, score: 1, expected: 'Ich hätte gern einen Kaffee, bitte.' });
    expect(r.diff!.every((d) => d.kind === 'same')).toBe(true);
    expect(r.diff!.map((d) => d.text)).toEqual(['Ich', 'hätte', 'gern', 'einen', 'Kaffee', 'bitte']);
    expect(r.feedback).toEqual(['Every word was recognised.']);
    expect(r.hints).toBeUndefined();
  });
  it('treats digits and number words as equal', () => {
    expect(gradeSpeech('Ich nehme drei Brötchen.', 'Ich nehme 3 Brötchen').score).toBe(1);
    expect(gradeSpeech('Das kostet 20 Franken.', 'das kostet zwanzig Franken').score).toBe(1);
    expect(gradeSpeech('Ich bin einundzwanzig.', 'ich bin 21').score).toBe(1);
    expect(gradeSpeech('Ich bin 21.', 'ich bin ein und zwanzig').score).toBe(1);
    expect(gradeSpeech('Um sieben Uhr.', 'um 7 uhr').score).toBe(1);
    expect(gradeSpeech('Zimmer hundert', 'Zimmer 100').score).toBe(1);
  });
  it('accepts the digit 1 for the indefinite article', () => {
    expect(gradeSpeech('Ich hätte gern einen Kaffee.', 'ich hätte gern 1 Kaffee').score).toBe(1);
    expect(gradeSpeech('Es ist eins.', 'es ist 1').score).toBe(1);
  });
  it('ignores filler words unless the target has them', () => {
    const r = gradeSpeech('Ich heisse Anna.', 'äh ich ähm heisse hm Anna');
    expect(r.score).toBe(1);
    expect(r.diff!.some((d) => d.kind === 'extra')).toBe(false);
    expect(gradeSpeech('Hm, gute Frage.', 'hm gute Frage').diff!.map((d) => d.kind)).toEqual(['same', 'same', 'same']);
  });
  it('accepts compounds split or joined by the recogniser', () => {
    const split = gradeSpeech('Wo ist die Kaffeetasse?', 'wo ist die Kaffee Tasse');
    expect(split.score).toBe(1);
    expect(split.diff!.map((d) => d.text)).toEqual(['Wo', 'ist', 'die', 'Kaffeetasse']);
    expect(gradeSpeech('Wo ist die Kaffeetasse?', 'wo ist die Kaffee-Tasse').score).toBe(1);
    expect(gradeSpeech('Ich habe Geburtstag.', 'Ich habe Geburts tag').score).toBe(1);
    const joined = gradeSpeech('Guten Morgen, Frau Keller!', 'gutenmorgen frau keller');
    expect(joined.score).toBe(1);
    expect(joined.diff!.map((d) => d.text)).toEqual(['Guten', 'Morgen', 'Frau', 'Keller']);
  });
  it('accepts ae/oe/ue and ss for umlauts and ß', () => {
    expect(gradeSpeech('Die Strasse ist schön.', 'die Straße ist schoen').score).toBe(1);
  });
  it('gives half credit and an ü hint when the umlaut is missing', () => {
    const r = gradeSpeech('Grüne Brötchen, bitte.', 'grune brotchen bitte');
    expect(r.score).toBeCloseTo((1 + 2 * SPEECH_NEAR_CREDIT) / 3);
    expect(r.correct).toBe(false);
    expect(ids(r)).toEqual(['ue', 'oe']);
    expect(r.hints![0]).toMatchObject({ label: 'ü sound', words: [{ expected: 'Grüne', heard: 'grune' }] });
    expect(r.diff![0]).toEqual({ text: 'grune', kind: 'wrong', expected: 'Grüne', hint: 'ue' });
    expect(r.feedback.some((f) => /ü sound: we heard “grune” for “Grüne”/.test(f))).toBe(true);
  });
  it('flags umlaut-less number words (funf for fünf) with the ü / ö hint and near credit', () => {
    const r = gradeSpeech('Fünf Brötchen', 'funf Brötchen');
    expect(r.score).toBeCloseTo((1 + SPEECH_NEAR_CREDIT) / 2);
    expect(ids(r)).toEqual(['ue']);
    expect(r.hints![0]!.words).toEqual([{ expected: 'Fünf', heard: 'funf' }]);
    expect(r.diff![0]).toEqual({ text: 'funf', kind: 'wrong', expected: 'Fünf', hint: 'ue' });
    const z = gradeSpeech('Ich bin zwölf.', 'ich bin zwolf');
    expect(ids(z)).toEqual(['oe']);
    expect(z.score).toBeCloseTo((2 + SPEECH_NEAR_CREDIT) / 3);
    expect(ids(gradeSpeech('fünfzig Franken', 'funfzig Franken'))).toEqual(['ue']);
    expect(ids(gradeSpeech('fünfundfünfzig', 'fünfundfunfzig'))).toEqual(['ue']);
    expect(ids(gradeSpeech('fünfzehn', 'funfzehn'))).toEqual(['ue']);
  });
  it('still accepts digits and ae/oe/ue spellings of number words', () => {
    for (const heard of ['5 Brötchen', 'fünf Brötchen', 'fuenf Brötchen']) {
      const r = gradeSpeech('Fünf Brötchen', heard);
      expect(r.score).toBe(1);
      expect(r.hints).toBeUndefined();
    }
    expect(gradeSpeech('zwölf', '12').score).toBe(1);
    expect(gradeSpeech('5 Brötchen', 'funf Brötchen').score).toBe(1);
  });
  it('flags umlaut-less Swiss number words too', () => {
    const r = gradeSpeech('drü Kafi', 'dru Kafi', { variety: 'gsw-zh' });
    expect(ids(r)).toEqual(['ue']);
    expect(r.score).toBeCloseTo((1 + SPEECH_NEAR_CREDIT) / 2);
  });
  it('keeps typed-number tolerance in the other graders unchanged', () => {
    const d = grade(ex({ type: 'dictation', transcript: 'Ich habe fünf Äpfel.' }), 'Ich habe fuenf Äpfel.');
    expect(d.correct).toBe(true);
  });
  it('still passes a long sentence with one umlaut-less word', () => {
    const r = gradeSpeech('Ich möchte heute Abend ins Kino gehen.', 'ich mochte heute abend ins kino gehen');
    expect(r.score).toBeGreaterThanOrEqual(SPEAK_PASS);
    expect(r.correct).toBe(true);
    expect(r.feedback[0]).toMatch(/^Good! Practise these words again: “möchte”/);
    expect(ids(r)).toEqual(['oe']);
  });
});

describe('gradeSpeech: pronunciation hints', () => {
  it('ch said as k or sh', () => {
    expect(ids(gradeSpeech('Ich spreche nicht.', 'ick spreche nicht'))).toEqual(['ch']);
    expect(ids(gradeSpeech('Das Buch', 'das buk'))).toEqual(['ch']);
    expect(ids(gradeSpeech('nicht', 'nisht'))).toEqual(['ch']);
  });
  it('does not flag chs (sechs) or sch', () => {
    expect(pronunciationIssues('sechs', 'seks')).toBeNull();
    expect(pronunciationIssues('Tisch', 'tik')).toBeNull();
  });
  it('final -er said as -a', () => {
    const r = gradeSpeech('Mein Vater', 'mein vata');
    expect(ids(r)).toEqual(['er']);
    expect(r.score).toBeCloseTo(1.5 / 2);
  });
  it('w and v', () => {
    expect(ids(gradeSpeech('Wasser', 'vasser'))).toEqual(['w-v']);
    expect(ids(gradeSpeech('Wie geht es?', 'vie geht es'))).toEqual(['w-v']);
  });
  it('z, ei/ie, vowel length and j', () => {
    expect(ids(gradeSpeech('Zug', 'sug'))).toEqual(['z']);
    expect(ids(gradeSpeech('Bier', 'beir'))).toEqual(['ei-ie']);
    expect(ids(gradeSpeech('mein', 'mien'))).toEqual(['ei-ie']);
    expect(ids(gradeSpeech('Hütte', 'Hüte'))).toEqual(['length']);
    expect(ids(gradeSpeech('Staat', 'Stat'))).toEqual(['length']);
    expect(ids(gradeSpeech('bieten', 'bitten'))).toEqual(['length']);
    expect(ids(gradeSpeech('Beet', 'Bett'))).toEqual(['length']);
    expect(ids(gradeSpeech('ja', 'dja'))).toEqual(['j']);
  });
  it('combines two issues in one word', () => {
    expect(pronunciationIssues('Bücher', 'bucha')).toEqual(['ue', 'er']);
  });
  it('Swiss word-initial ch said as k only for Swiss varieties', () => {
    expect(pronunciationIssues('Chäs', 'Käs', 'gsw-zh')).toEqual(['ch']);
    expect(pronunciationIssues('Chef', 'kef')).toBeNull();
  });
  it('reports each issue once, in rule order, with all affected words', () => {
    const r = gradeSpeech('Ich möchte schöne Würste.', 'ick mochte schone wurste');
    expect(ids(r)).toEqual(['ue', 'oe', 'ch']);
    expect(r.hints!.find((h) => h.id === 'oe')!.words).toEqual([
      { expected: 'möchte', heard: 'mochte' },
      { expected: 'schöne', heard: 'schone' },
    ]);
  });
  it('a minimal-pair partner is not accepted as the target', () => {
    const r = gradeSpeech('Mütter', 'Mutter');
    expect(r.correct).toBe(false);
    expect(r.score).toBe(SPEECH_NEAR_CREDIT);
    expect(ids(r)).toEqual(['ue']);
  });
});

describe('gradeSpeech: diff and scoring', () => {
  it('marks missing, extra and wrong words', () => {
    const r = gradeSpeech('Ich wohne in Zürich.', 'ich wohne jetzt in Bern');
    expect(r.diff).toEqual([
      { text: 'Ich', kind: 'same' },
      { text: 'wohne', kind: 'same' },
      { text: 'jetzt', kind: 'extra' },
      { text: 'in', kind: 'same' },
      { text: 'Bern', kind: 'wrong', expected: 'Zürich' },
    ]);
    expect(r.score).toBe(0.75);
    expect(r.correct).toBe(false);
  });
  it('aligns a similar but wrong word with its target', () => {
    const r = gradeSpeech('Ich wohne in Basel.', 'ich wohne in Bastel');
    expect(r.diff![3]).toEqual({ text: 'Bastel', kind: 'wrong', expected: 'Basel' });
    expect(r.score).toBe(0.75);
  });
  it('handles silence and an empty target', () => {
    expect(gradeSpeech('Hallo!', '').feedback[0]).toMatch(/did not hear/);
    expect(gradeSpeech('Hallo!', 'äh hm').feedback[0]).toMatch(/did not hear/);
    expect(gradeSpeech('', 'hallo')).toMatchObject({ correct: false, score: 0 });
  });
  it('keeps Swiss minimal pairs apart (ue/üe, ie/ii)', () => {
    expect(gradeSpeech('Brüeder', 'Brueder', { variety: 'gsw-zh' }).correct).toBe(false);
    expect(gradeSpeech('wie', 'Wii', { variety: 'gsw-zh' }).correct).toBe(false);
    expect(gradeSpeech('Füür', 'für', { variety: 'gsw-zh' }).correct).toBe(false);
    expect(gradeSpeech('Merci vilmal', 'merci villmal', { variety: 'gsw-zh' }).score).toBe(1);
  });
  it('uses the Swiss spelling fold for dialect targets', () => {
    expect(gradeSpeech('Ich hätt gern es Bier.', 'ich het gern 1 bier', { variety: 'gsw-zh' }).score).toBe(1);
    expect(gradeSpeech('Das choschtet drü Franke.', 'das chostet 3 franke', { variety: 'gsw-zh' }).score).toBe(1);
  });
  it('is used by grade() for speak exercises', () => {
    const s = ex({ type: 'speak', skill: 'speaking', target: 'Ich nehme zwei Kaffeetassen.' });
    expect(grade(s, 'äh ich nehme 2 Kaffee Tassen')).toMatchObject({ correct: true, score: 1 });
    const swiss = ex({ type: 'speak', skill: 'speaking', variety: 'gsw-zh', target: 'Grüezi mitenand!' });
    expect(grade(swiss, 'grüezi mitenand').correct).toBe(true);
  });
  it('accepts every target read back verbatim', () => {
    for (const t of ['Guten Morgen!', 'Wie geht’s?', 'Ich bin 25 Jahre alt.', 'Das ist „super“ – oder?', 'Tschüss / Ciao', 'Kaffee-Tasse']) {
      expect(gradeSpeech(t, t).correct).toBe(true);
    }
  });
});
