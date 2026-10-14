import { describe, expect, it } from 'vitest';
import { base58Encode, isSolanaAddressFormat, shortenAddress } from '../src/address.js';

describe('isSolanaAddressFormat', () => {
  it('accepts valid 32-byte base58 addresses', () => {
    expect(isSolanaAddressFormat('11111111111111111111111111111111')).toBe(true);
    expect(isSolanaAddressFormat('Vote111111111111111111111111111111111111111')).toBe(true);
    expect(isSolanaAddressFormat('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe(true);
  });

  it.each([
    '',
    'not-an-address',
    '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', // Ethereum
    '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWW0', // contains 0
    '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWMxx', // too long
    '1111111111111111111111111111111', // 31 bytes
  ])('rejects "%s"', (input) => {
    expect(isSolanaAddressFormat(input)).toBe(false);
  });
});

describe('shortenAddress', () => {
  it('keeps the head and tail', () => {
    expect(shortenAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe('9WzD…AWWM');
  });
});

describe('base58Encode', () => {
  it('matches known vectors', () => {
    expect(base58Encode(new Uint8Array(32))).toBe('11111111111111111111111111111111');
    expect(base58Encode(new TextEncoder().encode('Hello World!'))).toBe('2NEpo7TZRRrLZSi2U');
    expect(base58Encode(Uint8Array.from([0, 0, 1]))).toBe('112');
  });

  it('round-trips through the address check for 32-byte keys', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256);
    expect(isSolanaAddressFormat(base58Encode(bytes))).toBe(true);
  });
});
