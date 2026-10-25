import { describe, expect, it } from 'vitest';
import { decryptKey, encryptKey } from '../src';

describe('key vault', () => {
  it('round-trips and uses a fresh salt and iv each time', async () => {
    const a = await encryptKey('sk-ant-123', 'correct horse');
    const b = await encryptKey('sk-ant-123', 'correct horse');
    expect(a).not.toBe(b);
    expect(a).not.toContain('sk-ant');
    const payload = JSON.parse(atob(a));
    expect(Object.keys(payload).sort()).toEqual(['ct', 'iv', 'salt', 'v']);
    expect(payload.v).toBe(1);
    expect(atob(payload.iv)).toHaveLength(12);
    expect(await decryptKey(a, 'correct horse')).toBe('sk-ant-123');
    expect(await decryptKey(b, 'correct horse')).toBe('sk-ant-123');
  });

  it('rejects a wrong passphrase', async () => {
    const a = await encryptKey('sk-ünïcödé', 'pass-1');
    await expect(decryptKey(a, 'pass-2')).rejects.toThrow(/Wrong passphrase/);
    expect(await decryptKey(a, 'pass-1')).toBe('sk-ünïcödé');
  });

  it('rejects garbage payloads', async () => {
    await expect(decryptKey('not base64 json', 'x')).rejects.toThrow(/format/);
    await expect(decryptKey(btoa('{"v":2}'), 'x')).rejects.toThrow(/format/);
  });
});
