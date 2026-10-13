/**
 * Exact SOL <-> lamports conversion.
 *
 * All blockchain and accounting amounts are integer lamports (bigint).
 * SOL strings exist only at the edges: parsing user input and formatting
 * values for display. JavaScript floating-point numbers are never used.
 */

export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000n;

const SOL_AMOUNT_PATTERN = /^(\d+)(?:\.(\d{1,9}))?$/;

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAmountError';
  }
}

/** Parses a decimal SOL string ("1.5", "0.000000001") into lamports. */
export function solToLamports(sol: string): bigint {
  const trimmed = sol.trim();
  const match = SOL_AMOUNT_PATTERN.exec(trimmed);
  if (!match) {
    throw new InvalidAmountError(
      `Invalid SOL amount "${sol}". Use a non-negative decimal with at most ${SOL_DECIMALS} decimal places.`,
    );
  }
  const whole = BigInt(match[1] ?? '0');
  const fraction = BigInt((match[2] ?? '').padEnd(SOL_DECIMALS, '0'));
  return whole * LAMPORTS_PER_SOL + fraction;
}

/**
 * Formats lamports as a SOL string with a fixed number of decimals.
 * When fewer than 9 decimals are requested the value is truncated
 * (never rounded up), so a displayed balance is never overstated.
 */
export function lamportsToSol(lamports: bigint | string, fractionDigits: number = SOL_DECIMALS): string {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > SOL_DECIMALS) {
    throw new RangeError(`fractionDigits must be an integer between 0 and ${SOL_DECIMALS}`);
  }
  const value = typeof lamports === 'bigint' ? lamports : BigInt(lamports);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / LAMPORTS_PER_SOL;
  const fraction = (abs % LAMPORTS_PER_SOL).toString().padStart(SOL_DECIMALS, '0').slice(0, fractionDigits);
  const sign = negative ? '-' : '';
  return fractionDigits === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}
