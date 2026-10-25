// A tiny compiled unit used by component tests. Content is illustrative, not course material.
import { CompiledUnit, LevelPack } from '@doppelpunkt/content-schema';

export const fixtureUnit: CompiledUnit = CompiledUnit.parse({
  id: 'a1-u01',
  level: 'A1',
  number: 1,
  title: 'Hallo!',
  titleEn: 'Hello!',
  goal: 'By the end you can greet people and say your name.',
  canDo: ['I can greet someone.', 'I can say my name.'],
  intro: {
    scene: 'Anna meets Ben at a café.',
    dialogue: [
      { speaker: 'Anna', text: 'Hallo, ich bin Anna.', en: 'Hello, I am Anna.' },
      { speaker: 'Ben', text: 'Hallo Anna, ich heiße Ben.', en: 'Hello Anna, my name is Ben.' },
    ],
  },
  grammar: [{ id: 'sein-present', title: 'sein (to be)', body: '**ich bin**, du bist, er/sie/es ist' }],
  swiss: {
    scene: 'The same meeting in Zurich.',
    dialogue: [{ speaker: 'Anna', text: 'Hoi, ich bi d Anna.', en: 'Hi, I am Anna.', variety: 'gsw-zh' }],
    notes: ['Swiss German uses an article before first names: *d Anna*.'],
  },
  vocab: [
    { id: 'hallo', de: 'hallo', en: 'hello', pos: 'phrase', gswZh: 'hoi' },
    { id: 'name', de: 'Name', en: 'name', pos: 'noun', gender: 'm', plural: 'die Namen' },
  ],
  exercises: [
    {
      id: 'a1-u01-mcq-1',
      type: 'mcq',
      skill: 'grammar',
      prompt: 'Choose the right form.',
      question: 'Ich ___ Anna.',
      options: ['bin', 'bist', 'ist'],
      answer: 0,
      explanation: 'With ich, sein becomes bin.',
      grammar: ['sein-present'],
    },
    {
      id: 'a1-u01-gap-1',
      type: 'gap',
      skill: 'grammar',
      prompt: 'Fill in the gap.',
      text: 'Du ___ Ben.',
      answers: [['bist']],
      explanation: 'With du, sein becomes bist.',
      grammar: ['sein-present'],
    },
    {
      id: 'a1-u01-order-1',
      type: 'order',
      skill: 'grammar',
      prompt: 'Put the words in order.',
      tokens: ['heiße', 'Ich', 'Ben'],
      answers: ['Ich heiße Ben'],
      explanation: 'The verb comes second.',
    },
  ],
});

export const fixturePack: LevelPack = { level: 'A1', version: 'test', builtAt: '2026-01-01T00:00:00.000Z', units: [fixtureUnit] };

export function exercise(id: string) {
  const ex = fixtureUnit.exercises.find((e) => e.id === id);
  if (!ex) throw new Error(`fixture exercise ${id} missing`);
  return ex;
}
