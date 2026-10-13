import { InvalidAmountError, solToLamports, type WithdrawalValidationDto } from '@wallet/shared';
import type { BlockchainProvider } from '../blockchain/types.js';
import type { WalletService } from './walletService.js';

/** Base fee for a single-signature transfer on Solana. */
export const ESTIMATED_TRANSFER_FEE_LAMPORTS = 5_000n;

/**
 * Withdrawal service — CHECKPOINT SCOPE: validation only.
 *
 * `validate()` performs real checks (address, amount, available on-chain
 * balance) but nothing is signed or broadcast. The next milestone adds
 * `requestWithdrawal()` which will persist a `withdrawals` row, write ledger
 * entries, sign with the decrypted key and call
 * BlockchainProvider.sendTransaction().
 */
export class WithdrawalService {
  constructor(
    private readonly wallets: WalletService,
    private readonly blockchain: BlockchainProvider,
  ) {}

  async validate(userId: string, input: { destinationAddress: string; amountSol: string }): Promise<WithdrawalValidationDto> {
    const issues: WithdrawalValidationDto['issues'] = [];
    const destinationAddress = input.destinationAddress.trim();

    const { wallet, lamports: available } = await this.wallets.getOnChainBalance(userId);

    if (!this.blockchain.isValidAddress(destinationAddress)) {
      issues.push({ field: 'destinationAddress', message: 'Not a valid Solana address' });
    } else if (destinationAddress === wallet.address) {
      issues.push({ field: 'destinationAddress', message: 'Destination is this wallet’s own address' });
    }

    let amountLamports: bigint | null = null;
    try {
      amountLamports = solToLamports(input.amountSol);
      if (amountLamports <= 0n) {
        issues.push({ field: 'amountSol', message: 'Amount must be greater than zero' });
      } else if (amountLamports + ESTIMATED_TRANSFER_FEE_LAMPORTS > available) {
        issues.push({ field: 'amountSol', message: 'Amount plus network fee exceeds the available balance' });
      }
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      issues.push({ field: 'amountSol', message: 'Enter a SOL amount with up to 9 decimal places' });
    }

    return {
      valid: issues.length === 0,
      destinationAddress,
      amountLamports: amountLamports?.toString() ?? null,
      estimatedFeeLamports: ESTIMATED_TRANSFER_FEE_LAMPORTS.toString(),
      availableLamports: available.toString(),
      issues,
      broadcastEnabled: false,
    };
  }
}
