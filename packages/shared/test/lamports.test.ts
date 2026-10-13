import { describe, expect, it } from 'vitest';
import { InvalidAmountError, LAMPORTS_PER_SOL, lamportsToSol, solToLamports } from '../src/lamports.js';

describe('solToLamports', () => {
  it('converts whole and fractional SOL exactly', () => {
    expect(solToLamports('1')).toBe(LAMPORTS_PER_SOL);
    expect(solToLamports('2.5')).toBe(2_500_000_000n);
    expect(solToLamports('0.000000001')).toBe(1n);
    expect(solToLamports('0.1')).toBe(100_000_000n);
    expect(solToLamports(' 3.000000000 ')).toBe(3_000_000_000n);
  });

  it('handles values beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
    expect(solToLamports('9007199254.740993')).toBe(9_007_199_254_740_993_000n);
  });

  it.each(['', '-1', '1.0000000001', 'abc', '1e9', '1,5', '.5', '1.'])('rejects "%s"', (input) => {
    expect(() => solToLamports(input)).toThrow(InvalidAmountError);
  });
});

describe('lamportsToSol', () => {
  it('formats with 9 decimals by default', () => {
    expect(lamportsToSol(1_000_000_000n)).toBe('1.000000000');
    expect(lamportsToSol(1n)).toBe('0.000000001');
    expect(lamportsToSol(0n)).toBe('0.000000000');
    expect(lamportsToSol('1500000000')).toBe('1.500000000');
  });

  it('truncates (never rounds up) when fewer decimals are requested', () => {
    expect(lamportsToSol(1_999_999_999n, 4)).toBe('1.9999');
    expect(lamportsToSol(1_999_999_999n, 0)).toBe('1');
  });

  it('formats negative amounts', () => {
    expect(lamportsToSol(-500_000_000n, 2)).toBe('-0.50');
  });

  it('round-trips', () => {
    for (const value of ['0', '0.000000001', '1.234567891', '42', '1000000.5']) {
      const lamports = solToLamports(value);
      expect(solToLamports(lamportsToSol(lamports))).toBe(lamports);
    }
  });
});
