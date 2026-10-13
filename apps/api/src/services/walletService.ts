import { SOLANA_NETWORK } from '@wallet/shared';
import type { BlockchainProvider, BlockchainTransaction } from '../blockchain/types.js';
import { Errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { SecretCipher } from '../lib/secretCipher.js';
import type { UserRepository } from '../repositories/userRepository.js';
import type { WalletAccount, WalletAccountRepository } from '../repositories/walletAccountRepository.js';

export interface OnChainBalance {
  wallet: WalletAccount;
  /** Live balance read from Solana Devnet. NOT the internal ledger balance. */
  lamports: bigint;
  fetchedAt: Date;
}

/**
 * Wallet application service.
 *
 * Depends only on `userId: string` — it has no knowledge of how the user was
 * authenticated (DemoUserMiddleware today, the client's JWT/session later).
 */
export class WalletService {
  constructor(
    private readonly users: UserRepository,
    private readonly wallets: WalletAccountRepository,
    private readonly blockchain: BlockchainProvider,
    private readonly cipher: SecretCipher,
  ) {}

  /** Returns the user's wallet, creating and persisting one on first use. Idempotent. */
  async getOrCreateWallet(userId: string): Promise<WalletAccount> {
    const existing = await this.wallets.findByUser(userId, SOLANA_NETWORK);
    if (existing) return existing;

    const user = await this.users.findById(userId);
    if (!user) throw Errors.userNotFound(userId);

    const generated = await this.blockchain.createWallet();
    let encryptedSecret: string;
    try {
      encryptedSecret = this.cipher.encrypt(generated.secretKey, generated.address);
      // Self-check: the stored envelope must decrypt back to the same key.
      const roundTrip = this.cipher.decrypt(encryptedSecret, generated.address);
      if (!roundTrip.equals(Buffer.from(generated.secretKey))) throw new Error('Secret encryption self-check failed');
      roundTrip.fill(0);
    } finally {
      generated.secretKey.fill(0);
    }

    const wallet = await this.wallets.createIfAbsent({
      userId,
      network: SOLANA_NETWORK,
      address: generated.address,
      encryptedSecret,
    });
    if (wallet.address === generated.address) {
      logger.info('Created wallet', { userId, network: wallet.network, address: wallet.address });
    }
    return wallet;
  }

  /** Real-time on-chain SOL balance of the user's wallet (source: Solana Devnet). */
  async getOnChainBalance(userId: string): Promise<OnChainBalance> {
    const wallet = await this.getOrCreateWallet(userId);
    const lamports = await this.blockchain.getBalance(wallet.address);
    return { wallet, lamports, fetchedAt: new Date() };
  }

  /** Recent on-chain activity for the wallet, read directly from the chain. */
  async getRecentOnChainTransactions(
    userId: string,
    limit = 10,
  ): Promise<{ wallet: WalletAccount; transactions: BlockchainTransaction[] }> {
    const wallet = await this.getOrCreateWallet(userId);
    const transactions = await this.blockchain.getRecentTransactions(wallet.address, limit);
    return { wallet, transactions };
  }

  explorerUrl(kind: 'address' | 'tx', value: string): string {
    return this.blockchain.explorerUrl(kind, value);
  }
}
