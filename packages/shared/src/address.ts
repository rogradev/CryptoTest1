/**
 * Lightweight, dependency-free Solana address format check (base58, 32 bytes).
 * Used by the frontend for instant feedback. The API performs the
 * authoritative check with @solana/web3.js `PublicKey`.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map([...BASE58_ALPHABET].map((char, index) => [char, index]));

function base58DecodedLength(input: string): number | null {
  if (input.length === 0) return null;
  const bytes: number[] = [];
  for (const char of input) {
    let carry = BASE58_MAP.get(char);
    if (carry === undefined) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += (bytes[i] ?? 0) * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeros = 0;
  while (input[leadingZeros] === '1') leadingZeros++;
  return bytes.length + leadingZeros;
}

export function isSolanaAddressFormat(address: string): boolean {
  if (address.length < 32 || address.length > 44) return false;
  return base58DecodedLength(address) === 32;
}

export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
