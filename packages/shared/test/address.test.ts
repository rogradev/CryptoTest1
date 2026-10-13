import { describe, expect, it } from 'vitest';
import { isSolanaAddressFormat, shortenAddress } from '../src/address.js';

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
