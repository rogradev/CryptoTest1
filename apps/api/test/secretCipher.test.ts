import { describe, expect, it } from 'vitest';
import { SecretCipher } from '../src/lib/secretCipher.js';
import { testKey } from './helpers.js';

describe('SecretCipher (AES-256-GCM)', () => {
  const secret = Uint8Array.from({ length: 64 }, (_, i) => i);

  it('round-trips and never stores plaintext', () => {
    const cipher = new SecretCipher(testKey());
    const envelope = cipher.encrypt(secret, 'ADDRESS');
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(envelope).not.toContain(Buffer.from(secret).toString('base64'));
    expect(cipher.decrypt(envelope, 'ADDRESS').equals(Buffer.from(secret))).toBe(true);
  });

  it('uses a fresh IV per encryption', () => {
    const cipher = new SecretCipher(testKey());
    expect(cipher.encrypt(secret, 'A')).not.toBe(cipher.encrypt(secret, 'A'));
  });

  it('fails with the wrong key, wrong address (AAD) or tampered ciphertext', () => {
    const cipher = new SecretCipher(testKey());
    const envelope = cipher.encrypt(secret, 'ADDRESS');
    expect(() => new SecretCipher(testKey()).decrypt(envelope, 'ADDRESS')).toThrow();
    expect(() => cipher.decrypt(envelope, 'OTHER_ADDRESS')).toThrow();
    const parts = envelope.split('.');
    const ct = Buffer.from(parts[3]!, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    expect(() => cipher.decrypt([parts[0], parts[1], parts[2], ct.toString('base64')].join('.'), 'ADDRESS')).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => new SecretCipher(Buffer.alloc(16))).toThrow();
  });
});
