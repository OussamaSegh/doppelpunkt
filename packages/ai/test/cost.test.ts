import { describe, expect, it } from 'vitest';
import { estimateTranscriptionCost, OPENAI_TRANSCRIBE_MODELS, TRANSCRIPTION_PRICES } from '../src';

describe('estimateTranscriptionCost', () => {
  it('prices OpenAI transcription per minute', () => {
    expect(estimateTranscriptionCost('openai', 'gpt-4o-transcribe', 60)).toBeCloseTo(0.006);
    expect(estimateTranscriptionCost('openai', 'whisper-1', 30)).toBeCloseTo(0.003);
    expect(estimateTranscriptionCost('openai', 'gpt-4o-mini-transcribe', 60)).toBeCloseTo(0.003);
    for (const m of OPENAI_TRANSCRIBE_MODELS) expect(TRANSCRIPTION_PRICES.openai?.[m]).toBeGreaterThan(0);
  });
  it('prices Gemini audio by model prefix, longest first', () => {
    expect(estimateTranscriptionCost('gemini', 'gemini-2.5-flash', 60)).toBeCloseTo(0.0024);
    expect(estimateTranscriptionCost('gemini', 'gemini-2.5-flash-lite-preview', 60)).toBeCloseTo(0.00066);
    expect(estimateTranscriptionCost('gemini', 'gemini-2.5-pro', 120)).toBeCloseTo(0.0088);
  });
  it('falls back per provider and returns 0 without transcription or duration', () => {
    expect(estimateTranscriptionCost('openai', 'some-future-model', 60)).toBeCloseTo(0.006);
    expect(estimateTranscriptionCost('gemini', 'gemini-9', 60)).toBeCloseTo(0.0024);
    expect(estimateTranscriptionCost('anthropic', 'claude-sonnet-5-5', 60)).toBe(0);
    expect(estimateTranscriptionCost('openai', 'whisper-1', 0)).toBe(0);
    expect(estimateTranscriptionCost('openai', 'whisper-1', Number.NaN)).toBe(0);
  });
});
