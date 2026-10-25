import { describe, expect, it } from 'vitest';
import { browserName, scrubRoute, scrubStack, scrubText, urlToOrigin } from './scrub';

// All keys below are fake: right shape, random characters.
const FAKE = {
  anthropic: 'sk-ant-api03-Zx9fakeFAKEfake_0123456789-abcdefABCDEF',
  openai: 'sk-proj-FAKEfake0123456789abcdefFAKE',
  openaiShort: 'sk-abc123def456',
  google: 'AIzaSyFAKE-fake_0123456789abcdefghij',
  xai: 'xai-FAKEfake0123456789abcdefFAKEfake',
};

describe('scrubText', () => {
  it.each(Object.entries(FAKE))('removes a %s key', (_name, key) => {
    const out = scrubText(`Request failed for key ${key} (401)`);
    expect(out).not.toContain(key);
    expect(out).not.toMatch(/sk-|AIza|xai-/);
    expect(out).toContain('[key]');
  });

  it('removes keys in headers, query strings and JSON', () => {
    const s = scrubText(
      `x-api-key: ${FAKE.anthropic}; Authorization: Bearer ${FAKE.openai}; {"apiKey":"${FAKE.google}"} key=${FAKE.xai}`,
    );
    for (const key of Object.values(FAKE)) expect(s).not.toContain(key);
    expect(s).toContain('x-api-key: [key]');
  });

  it('removes keys glued to other text', () => {
    expect(scrubText(`key:${FAKE.openai}.`)).not.toContain('FAKEfake');
    expect(scrubText(`("${FAKE.anthropic}")`)).toBe('("[key]")');
  });

  it('removes long random tokens and hex ids', () => {
    const hex = 'a3f9c2e1b4d5f60718293a4b5c6d7e8f';
    expect(scrubText(`install ${hex}`)).toBe('install [key]');
  });

  it('removes email addresses', () => {
    expect(scrubText('Contact anna.muster+dp@example.ch now')).toBe('Contact [email] now');
  });

  it('reduces URLs to their origin', () => {
    expect(scrubText('GET https://api.example.com/v1/users/me?token=abc#x failed')).toBe('GET https://api.example.com failed');
    expect(scrubText('see http://localhost:5173/unit/a1-u01?x=1')).toBe('see http://localhost:5173');
    expect(urlToOrigin('not a url')).toBe('[url]');
  });

  it('removes runs of 5 or more digits but keeps short numbers', () => {
    expect(scrubText('Phone 0791234567, code 1234, id 12345')).toBe('Phone [n], code 1234, id [n]');
  });

  it('caps the length', () => {
    expect(scrubText('x'.repeat(30) + ' ' + 'y '.repeat(400), 100)).toHaveLength(100);
  });

  it('accepts non-strings', () => {
    expect(scrubText(undefined)).toBe('');
    expect(scrubText(42)).toBe('42');
  });
});

describe('scrubStack', () => {
  it('reduces file URLs to bundle file names and keeps line/column numbers', () => {
    const stack = [
      'TypeError: x is undefined',
      '    at Feedback (https://doppelpunkt.app/assets/index-B4kd9xQz.js:12:123456)',
      '    at https://doppelpunkt.app/assets/Exam-Cq1.js?v=3:1:99999',
      'render@https://doppelpunkt.app/assets/react-Dx.js:3:40000',
    ].join('\n');
    const out = scrubStack(stack);
    expect(out).toContain('index-B4kd9xQz.js:12:123456');
    expect(out).toContain('Exam-Cq1.js:1:99999');
    expect(out).toContain('render@react-Dx.js:3:40000');
    expect(out).not.toContain('doppelpunkt.app');
  });

  it('removes keys, emails and long numbers from stacks', () => {
    const stack = `Error: bad key ${FAKE.anthropic} for a@b.ch order 1234567\n    at f (https://x.test/assets/a.js:1:2)`;
    const out = scrubStack(stack);
    expect(out).not.toContain(FAKE.anthropic);
    expect(out).not.toContain('a@b.ch');
    expect(out).not.toContain('1234567');
    expect(out).toContain('a.js:1:2');
  });

  it('caps lines and length', () => {
    const long = Array.from({ length: 100 }, (_, i) => `    at f${i} (https://x.test/assets/a.js:1:${i})`).join('\n');
    const out = scrubStack(long, 4000);
    expect(out.split('\n')).toHaveLength(40);
    expect(scrubStack(long, 200).length).toBeLessThanOrEqual(200);
  });
});

describe('scrubRoute and browserName', () => {
  it('drops query and hash from the route', () => {
    expect(scrubRoute('/unit/a1-u01/practice?email=a@b.ch#top')).toBe('/unit/a1-u01/practice');
    expect(scrubRoute('/exam/123456')).toBe('/exam/[n]');
  });

  it('keeps only the browser family and major version', () => {
    expect(browserName('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.85 Safari/537.36')).toBe('Chrome 131');
    expect(browserName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe(
      'Safari 18 (iOS)',
    );
    expect(browserName('Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0')).toBe('Firefox 132 (Android)');
    expect(browserName('curl/8')).toBe('Other');
  });
});
