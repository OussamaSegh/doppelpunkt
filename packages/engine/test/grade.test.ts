import { describe, expect, it } from 'vitest';
import { ALMOST_SCORE, CASE_SCORE, grade, needsAiGrading } from '../src';
import { ex } from './helpers';

describe('mcq', () => {
  const q = ex({ type: 'mcq', options: ['der', 'die', 'das'], answer: 1, rationales: ['No: Lampe is feminine.', 'Yes.', 'No.'] });
  it('grades by index and returns the rationale', () => {
    expect(grade(q, 1)).toMatchObject({ correct: true, score: 1, expected: 'die', feedback: ['Yes.'] });
    expect(grade(q, 0)).toMatchObject({ correct: false, score: 0, feedback: ['No: Lampe is feminine.'] });
  });
  it('handles a non-number answer', () => {
    expect(grade(q, 'die').correct).toBe(false);
  });
});

describe('gap', () => {
  const article = ex({ type: 'gap', text: 'Das ist ___ Tisch.', answers: [['der']] });
  it('accepts the exact answer', () => {
    expect(grade(article, ['der'])).toMatchObject({ correct: true, score: 1, expected: 'Das ist der Tisch.', parts: [true] });
    expect(grade(article, 'der').correct).toBe(true);
  });
  it('flags "Der" mid-sentence with a capitalisation hint', () => {
    const r = grade(article, ['Der']);
    expect(r.correct).toBe(false);
    expect(r.score).toBe(CASE_SCORE);
    expect(r.feedback.join(' ')).toMatch(/Only nouns .* capital letter: write “der”, not “Der”/);
  });
  it('flags a lower-case noun with "capitalise nouns"', () => {
    const noun = ex({ type: 'gap', text: 'Ich trinke einen ___.', answers: [['Kaffee']] });
    const r = grade(noun, ['kaffee']);
    expect(r.correct).toBe(false);
    expect(r.feedback.join(' ')).toMatch(/Capitalise nouns in German: write “Kaffee”, not “kaffee”/);
  });
  it('ignores case at the start of a sentence', () => {
    const start = ex({ type: 'gap', text: '___ ist der Tisch.', answers: [['Das']] });
    expect(grade(start, ['das']).correct).toBe(true);
    const afterStop = ex({ type: 'gap', text: 'Hallo. ___ bin Anna.', answers: [['Ich']] });
    expect(grade(afterStop, ['ich']).correct).toBe(true);
  });
  it('accepts any listed variant and gives partial credit per gap', () => {
    const g = ex({ type: 'gap', text: 'Ich ___ aus ___.', answers: [['komme'], ['der Schweiz', 'Schweiz']] });
    expect(grade(g, ['komme', 'Schweiz']).correct).toBe(true);
    const half = grade(g, ['bin', 'der Schweiz']);
    expect(half.correct).toBe(false);
    expect(half.score).toBe(0.5);
    expect(half.parts).toEqual([false, true]);
    expect(half.feedback[0]).toMatch(/^Gap 1:/);
  });
  it('reports empty gaps', () => {
    const g = ex({ type: 'gap', text: 'Ich ___ aus ___.', answers: [['komme'], ['Bern']] });
    const r = grade(g, ['komme']);
    expect(r.score).toBe(0.5);
    expect(r.feedback).toContain('Gap 2 is empty.');
  });
  it('treats Straße and Strasse as equal, with a hint for Germany spelling', () => {
    const g = ex({ type: 'gap', text: 'Ich wohne in der ___.', answers: [['Straße']] });
    const r = grade(g, ['Strasse']);
    expect(r.correct).toBe(true);
    expect(r.feedback.join(' ')).toMatch(/spelled with ß/);
    const ch = ex({ type: 'gap', variety: 'ch-std', text: 'Ich wohne an der ___.', answers: [['Strasse']] });
    const r2 = grade(ch, ['Straße']);
    expect(r2.correct).toBe(true);
    expect(r2.feedback.join(' ')).toMatch(/Swiss spelling never uses ß/);
  });
  it('accepts ae/oe/ue for umlauts with a hint (Mueller)', () => {
    const g = ex({ type: 'gap', text: 'Mein Name ist ___.', answers: [['Müller']] });
    const r = grade(g, ['Mueller']);
    expect(r.correct).toBe(true);
    expect(r.score).toBe(1);
    expect(r.feedback.join(' ')).toMatch(/correct spelling is “Müller”/);
  });
  it('gives "almost" for a one-letter typo', () => {
    const g = ex({ type: 'gap', text: 'Ich habe einen ___.', answers: [['Hund']] });
    const r = grade(g, ['Hunt']);
    expect(r.correct).toBe(false);
    expect(r.score).toBe(ALMOST_SCORE);
    expect(r.feedback.join(' ')).toMatch(/Almost! “Hunt” should be “Hund”/);
  });
  it('is spelling-tolerant for Swiss German gaps', () => {
    const g = ex({ type: 'gap', variety: 'gsw-zh', text: 'Das ___ föif Franke.', answers: [['chostet']] });
    const r = grade(g, ['choschtet']);
    expect(r.correct).toBe(true);
    expect(r.feedback.join(' ')).toMatch(/no fixed spelling/);
  });
});

describe('order', () => {
  const o = ex({
    type: 'order',
    tokens: ['ich', 'Morgen', 'gehe', 'ins Kino'],
    answers: ['Morgen gehe ich ins Kino.', 'Ich gehe morgen ins Kino.'],
  });
  it('accepts any listed word order, as a string or token array', () => {
    expect(grade(o, 'Morgen gehe ich ins Kino').correct).toBe(true);
    expect(grade(o, ['ich', 'gehe', 'Morgen', 'ins Kino']).correct).toBe(true);
  });
  it('gives a verb-position hint and partial credit for a wrong order', () => {
    const r = grade(o, ['Morgen', 'ich', 'gehe', 'ins Kino']);
    expect(r.correct).toBe(false);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(0.5);
    expect(r.feedback[0]).toMatch(/position 2/);
    expect(r.expected).toBe('Morgen gehe ich ins Kino.');
    expect(r.diff?.some((d) => d.kind !== 'same')).toBe(true);
  });
  it('asks to use each word once when tokens are missing', () => {
    expect(grade(o, 'Morgen gehe ich').feedback[0]).toMatch(/each word exactly once/);
  });
});

describe('match', () => {
  const m = ex({ type: 'match', pairs: [['Hallo', 'Hello'], ['Tschüss', 'Bye'], ['Danke', 'Thanks']] });
  it('scores correct pairs', () => {
    expect(grade(m, [['Hallo', 'Hello'], ['Tschüss', 'Bye'], ['Danke', 'Thanks']]).correct).toBe(true);
    const r = grade(m, [['Hallo', 'Hello'], ['Tschüss', 'Thanks'], ['Danke', 'Bye']]);
    expect(r.score).toBeCloseTo(1 / 3);
    expect(r.parts).toEqual([true, false, false]);
    expect(r.feedback).toContain('“Danke” goes with “Thanks”.');
  });
  it('ignores case and order of the submitted pairs', () => {
    expect(grade(m, [['danke', 'thanks'], ['hallo', 'hello'], ['tschüss', 'bye']]).correct).toBe(true);
  });
});

describe('dictation', () => {
  const d = ex({ type: 'dictation', skill: 'listening', transcript: 'Herr Müller wohnt in der Bahnhofstraße.' });
  it('accepts a perfect transcript, ignoring final punctuation and ß/ss', () => {
    expect(grade(d, 'Herr Müller wohnt in der Bahnhofstrasse')).toMatchObject({ correct: true, score: 1 });
  });
  it('scores matched/total words', () => {
    const r = grade(d, 'Herr Müller wohnt in Bahnhofstraße');
    expect(r.score).toBeCloseTo(5 / 6);
    expect(r.correct).toBe(false);
    expect(r.feedback.join(' ')).toMatch(/Listen again for: “der”/);
  });
  it('accepts the umlaut fallback with a hint', () => {
    const r = grade(d, 'Herr Mueller wohnt in der Bahnhofstraße');
    expect(r.correct).toBe(true);
    expect(r.feedback.join(' ')).toMatch(/ae\/oe\/ue/);
  });
  it('penalises capitalisation mistakes with a hint', () => {
    const r = grade(d, 'Herr Müller wohnt in der bahnhofstraße');
    expect(r.correct).toBe(false);
    expect(r.score).toBeCloseTo(5.5 / 6);
    expect(r.feedback.join(' ')).toMatch(/Capitalise nouns/);
  });
});

describe('translate', () => {
  const t = ex({ type: 'translate', skill: 'writing', source: 'I come from Switzerland.', answers: ['Ich komme aus der Schweiz.', 'Ich bin aus der Schweiz.'] });
  it('accepts listed answers after normalisation', () => {
    expect(grade(t, 'ich komme aus der Schweiz').correct).toBe(true);
    expect(grade(t, 'Ich bin aus der Schweiz!').correct).toBe(true);
  });
  it('returns "almost" for a one-letter slip per word and shows the closest answer', () => {
    const r = grade(t, 'Ich bin aus der Schwiez');
    expect(r.correct).toBe(false);
    expect(r.score).toBe(ALMOST_SCORE);
    expect(r.expected).toBe('Ich bin aus der Schweiz.');
    expect(r.feedback[0]).toMatch(/^Almost!/);
  });
  it('flags a lower-case noun', () => {
    const r = grade(t, 'Ich komme aus der schweiz');
    expect(r.correct).toBe(false);
    expect(r.feedback[0]).toMatch(/Capitalise nouns/);
  });
  it('marks unknown answers for AI grading', () => {
    const r = grade(t, 'Ich stamme aus Helvetien');
    expect(r.correct).toBe(false);
    expect(r.needsAi).toBe(true);
    expect(needsAiGrading(t, r)).toBe(true);
    expect(needsAiGrading(t)).toBe(false);
  });
  it('is case-insensitive for translations into English', () => {
    const en = ex({ type: 'translate', source: 'Wie heisst du?', answers: ['What is your name?', "What's your name?"] });
    expect(grade(en, 'what is your Name').correct).toBe(true);
  });
  it('accepts Swiss German translations with spelling tolerance', () => {
    const gsw = ex({ type: 'translate', variety: 'gsw-zh', source: 'Thank you very much', answers: ['Merci vilmal'] });
    expect(grade(gsw, 'Merci vielmal').correct).toBe(true);
    expect(grade(gsw, 'merci vilmal').correct).toBe(true);
  });
});

describe('transform', () => {
  const tr = ex({
    type: 'transform', variety: 'gsw-zh', from: 'de', to: 'gsw-zh',
    source: 'Guten Tag!', answers: ['Grüezi', 'Grüezi mitenand'],
  });
  it('accepts listed Zurich and Bernese forms', () => {
    expect(grade(tr, 'Grüezi!').correct).toBe(true);
    const be = ex({ type: 'transform', variety: 'gsw-be', from: 'de', to: 'gsw-be', source: 'Guten Tag', answers: ['Grüessech', 'Grüess Gott'] });
    expect(grade(be, 'Grüessech').correct).toBe(true);
    expect(grade(be, 'grüesech').correct).toBe(true);
    expect(grade(be, 'Grüezi').correct).toBe(false);
  });
  it('tolerates Swiss spelling variants (choschtet / chostet, ä / e)', () => {
    const p = ex({ type: 'transform', variety: 'gsw-zh', from: 'de', to: 'gsw-zh', source: 'Was kostet das?', answers: ['Was chostet das?'] });
    expect(grade(p, 'Was choschtet das').correct).toBe(true);
    const k = ex({ type: 'transform', variety: 'gsw-zh', from: 'de', to: 'gsw-zh', source: 'Käse', answers: ['Chäs'] });
    expect(grade(k, 'Ches').correct).toBe(true);
  });
  it('uses Standard German rules when transforming into de', () => {
    const p = ex({ type: 'transform', variety: 'gsw-zh', from: 'gsw-zh', to: 'de', source: 'Was chostet das?', answers: ['Was kostet das?'] });
    expect(grade(p, 'Was kostet das').correct).toBe(true);
    expect(grade(p, 'Was choschtet das').correct).toBe(false);
    expect(grade(p, 'Was choschtet das').needsAi).toBeUndefined();
  });
});

describe('speak', () => {
  const s = ex({ type: 'speak', skill: 'speaking', target: 'Ich hätte gern einen Kaffee, bitte.' });
  it('compares a transcript word by word', () => {
    expect(grade(s, 'ich hätte gern einen kaffee bitte')).toMatchObject({ correct: true, score: 1 });
    const r = grade(s, 'ich hatte gern einen kaffee');
    // 4 words right, "hatte" for "hätte" earns half credit (ä sound), "bitte" is missing.
    expect(r.score).toBeCloseTo(4.5 / 6);
    expect(r.correct).toBe(false);
    expect(r.feedback[0]).toMatch(/“hätte”/);
    expect(r.hints?.map((h) => h.id)).toEqual(['ae']);
  });
  it('passes at 80 % recognised words', () => {
    expect(grade(s, 'ich hätte gern einen kaffee').correct).toBe(true);
  });
  it('handles silence', () => {
    expect(grade(s, '').feedback[0]).toMatch(/did not hear/);
  });
});

describe('open types', () => {
  it('write and roleplay need AI', () => {
    const w = ex({ type: 'write', skill: 'writing', task: 'Introduce yourself.', model: 'Ich heisse Anna.', checklist: ['Name'] });
    const r = grade(w, 'Ich heisse Tom.');
    expect(r).toMatchObject({ needsAi: true, correct: false, expected: 'Ich heisse Anna.' });
    expect(needsAiGrading(w)).toBe(true);
    const rp = ex({ type: 'roleplay', skill: 'speaking', scenario: 'Café', goals: ['Order'], model: 'A: …' });
    expect(needsAiGrading(rp)).toBe(true);
    expect(grade(rp, '').needsAi).toBe(true);
  });
  it('closed types do not need AI', () => {
    expect(needsAiGrading(ex({ type: 'mcq', options: ['a', 'b'], answer: 0 }))).toBe(false);
  });
});
