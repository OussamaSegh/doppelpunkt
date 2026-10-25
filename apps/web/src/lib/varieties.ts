import type { Variety } from '@doppelpunkt/content-schema';

export type VarietyMeta = { tag: string; name: string; swiss: boolean; lang: string };

export const VARIETY_META: Record<Variety, VarietyMeta> = {
  de: { tag: 'DE', name: 'Standard German (Germany)', swiss: false, lang: 'de-DE' },
  'ch-std': { tag: 'CH', name: 'Swiss Standard German', swiss: true, lang: 'de-CH' },
  'gsw-zh': { tag: 'ZH', name: 'Zurich German', swiss: true, lang: 'gsw-CH' },
  'gsw-be': { tag: 'BE', name: 'Bernese German', swiss: true, lang: 'gsw-CH' },
};

/** Speech engines rarely know gsw; de-CH is the closest available voice. */
export function ttsLang(v: Variety): string {
  return v === 'de' ? 'de-DE' : 'de-CH';
}
