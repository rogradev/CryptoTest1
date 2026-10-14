import type pg from 'pg';
import { SecretCipher } from '../../src/lib/secretCipher.js';
import { PgUserRepository } from '../../src/repositories/userRepository.js';
import { PgWalletAccountRepository } from '../../src/repositories/walletAccountRepository.js';
import { AccountService } from '../../src/services/accountService.js';
import { DepositSyncService } from '../../src/services/depositSyncService.js';
import { LedgerService } from '../../src/services/ledgerService.js';
import { WalletKeyStore } from '../../src/services/walletKeyStore.js';
import { WalletService } from '../../src/services/walletService.js';
import { WithdrawalService, type WithdrawalPolicy } from '../../src/services/withdrawalService.js';
import { MockBlockchainProvider, testKey } from '../helpers.js';

export const SOL = 1_000_000_000n;
export const FEE = 5_000n;

/** Wires the real services against a scratch database and the fake chain. */
export function buildServices(
  pool: pg.Pool,
  options: { chain?: MockBlockchainProvider; key?: Buffer; policy?: Partial<WithdrawalPolicy> } = {},
) {
  const chain = options.chain ?? new MockBlockchainProvider();
  const cipher = new SecretCipher(options.key ?? testKey());
  const walletRepo = new PgWalletAccountRepository(pool);
  const wallets = new WalletService(new PgUserRepository(pool), walletRepo, chain, cipher);
  const ledger = new LedgerService(pool);
  const withdrawals = new WithdrawalService(pool, wallets, ledger, new WalletKeyStore(walletRepo, cipher), chain, {
    enabled: true,
    accessCode: null,
    maxLamports: 2n * SOL,
    ...options.policy,
  });
  const sync = new DepositSyncService(pool, wallets, ledger, chain, withdrawals);
  const account = new AccountService(pool, wallets, ledger, chain, sync, withdrawals);
  return { chain, wallets, ledger, withdrawals, sync, account };
}
