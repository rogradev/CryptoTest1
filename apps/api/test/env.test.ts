import { describe, expect, it } from 'vitest';
import { EnvValidationError, decodeEncryptionKey, parseEnv } from '../src/config/env.js';

const validKey = Buffer.alloc(32, 7).toString('base64');
const base = {
  DATABASE_URL: 'postgresql://wallet:wallet@localhost:5432/wallet_prototype',
  WALLET_ENCRYPTION_KEY: validKey,
};

describe('parseEnv', () => {
  it('applies devnet defaults', () => {
    const env = parseEnv(base);
    expect(env.SOLANA_CLUSTER).toBe('devnet');
    expect(env.SOLANA_RPC_URL).toBe('https://api.devnet.solana.com');
    expect(env.PORT).toBe(3001);
    expect(env.DEMO_USER_ID).toBe('demo-user-001');
    expect(env.WALLET_ENCRYPTION_KEY).toHaveLength(32);
  });

  it('accepts a 64-char hex key', () => {
    expect(parseEnv({ ...base, WALLET_ENCRYPTION_KEY: 'ab'.repeat(32) }).WALLET_ENCRYPTION_KEY).toHaveLength(32);
  });

  it('requires DATABASE_URL and WALLET_ENCRYPTION_KEY', () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
    try {
      parseEnv({});
    } catch (error) {
      const issues = (error as EnvValidationError).issues.join('\n');
      expect(issues).toContain('DATABASE_URL');
      expect(issues).toContain('WALLET_ENCRYPTION_KEY');
    }
  });

  it.each(['mainnet-beta', 'testnet', 'localnet'])('rejects SOLANA_CLUSTER=%s', (cluster) => {
    expect(() => parseEnv({ ...base, SOLANA_CLUSTER: cluster })).toThrow(/devnet/);
  });

  it('rejects a mainnet RPC URL', () => {
    expect(() => parseEnv({ ...base, SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' })).toThrow(/mainnet/);
  });

  it('rejects weak or malformed encryption keys without echoing them', () => {
    for (const key of ['short', 'a'.repeat(63), Buffer.alloc(16).toString('base64')]) {
      try {
        parseEnv({ ...base, WALLET_ENCRYPTION_KEY: key });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        expect((error as Error).message).not.toContain(key);
      }
    }
  });

  it('rejects a non-postgres DATABASE_URL and invalid PORT', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
  });
});

describe('decodeEncryptionKey', () => {
  it('decodes base64 and hex 32-byte keys', () => {
    expect(decodeEncryptionKey(validKey)?.length).toBe(32);
    expect(decodeEncryptionKey('00'.repeat(32))?.length).toBe(32);
    expect(decodeEncryptionKey('nope')).toBeNull();
  });
});
