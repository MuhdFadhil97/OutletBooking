import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../src/services/crypto';

describe('secret encryption (AES-256-GCM)', () => {
  const key = randomBytes(32);

  it('round-trips, and never stores the plain text', () => {
    const secret = 'w5x7srq7-rx5r-3t8b-4sl2-h0kh0xwnxwk4';
    const stored = encryptSecret(secret, key);
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored, key)).toBe(secret);
  });

  it('a fresh IV each time', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  it('fails with the wrong key or tampered data', () => {
    const stored = encryptSecret('secret', key);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
    const parts = stored.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
    expect(() => decryptSecret('plain-text', key)).toThrow('Unknown secret format');
  });

  it('key must be 32 bytes', () => {
    expect(parseEncryptionKey(randomBytes(32).toString('base64'))).toHaveLength(32);
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow('32 bytes');
  });
});
