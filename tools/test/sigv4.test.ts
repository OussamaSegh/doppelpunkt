import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { amzDate, EMPTY_SHA256, signingKey, signV4, uriEncode } from '../src/sigv4';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// Example vectors from the AWS documentation.
describe('signV4', () => {
  it('matches the IAM ListUsers example (Signature Version 4 docs)', () => {
    const r = signV4({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      region: 'us-east-1',
      service: 'iam',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      date: new Date('2015-08-30T12:36:00Z'),
    });
    expect(r.canonicalRequest).toBe([
      'GET', '/', 'Action=ListUsers&Version=2010-05-08',
      'content-type:application/x-www-form-urlencoded; charset=utf-8', 'host:iam.amazonaws.com', 'x-amz-date:20150830T123600Z', '',
      'content-type;host;x-amz-date', EMPTY_SHA256,
    ].join('\n'));
    expect(sha(r.canonicalRequest)).toBe('f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59');
    expect(r.stringToSign).toBe('AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/iam/aws4_request\nf536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59');
    expect(signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam').toString('hex'))
      .toBe('c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
    expect(r.signature).toBe('5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
    expect(r.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });

  const s3 = { region: 'us-east-1', service: 's3', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', date: new Date('2013-05-24T00:00:00Z') };

  it('matches the S3 GET Object example (Authorization header)', () => {
    const r = signV4({
      ...s3,
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { Range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256 },
    });
    expect(sha(r.canonicalRequest)).toBe('7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972');
    expect(r.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('matches the S3 PUT Object example, encoding $ in the key once', () => {
    const body = 'Welcome to Amazon S3.';
    const r = signV4({
      ...s3,
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/test$file.text',
      headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': sha(body) },
      payloadHash: sha(body),
    });
    expect(r.canonicalRequest.split('\n')[1]).toBe('/test%24file.text');
    expect(r.signature).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('encodes like RFC 3986 and formats dates', () => {
    expect(uriEncode("a b+c/d!'()*~._-")).toBe('a%20b%2Bc%2Fd%21%27%28%29%2A~._-');
    expect(amzDate(new Date('2026-10-25T08:09:10.123Z'))).toBe('20261025T080910Z');
    // Already-encoded URL segments are not double-encoded.
    const r = signV4({ ...s3, method: 'HEAD', url: 'https://x.r2.cloudflarestorage.com/bucket/a%20b/%C3%BC.mp3' });
    expect(r.canonicalRequest.split('\n')[1]).toBe('/bucket/a%20b/%C3%BC.mp3');
  });
});
