import type pg from 'pg';
import { SOLANA_NETWORK, type HealthDto } from '@wallet/shared';
import type { Env } from './config/env.js';
import type { RequestHandler } from 'express';
import { createApp } from './createApp.js';
import { createDatabaseBootstrap } from './db/bootstrap.js';
import { SolanaDevnetProvider } from './blockchain/solanaDevnetProvider.js';
import type { BlockchainProvider } from './blockchain/types.js';
import { SecretCipher } from './lib/secretCipher.js';
import { demoUserMiddleware } from './middleware/demoUser.js';
import { PgUserRepository } from './repositories/userRepository.js';
import { PgWalletAccountRepository } from './repositories/walletAccountRepository.js';
import { AccountService } from './services/accountService.js';
import { DepositSyncService } from './services/depositSyncService.js';
import { LedgerService } from './services/ledgerService.js';
import { WalletKeyStore } from './services/walletKeyStore.js';
import { WalletService } from './services/walletService.js';
import { WithdrawalService } from './services/withdrawalService.js';

/** Composition root: wires infrastructure into application services. */
export function createContainer(env: Env, pool: pg.Pool, blockchain: BlockchainProvider = new SolanaDevnetProvider(env.SOLANA_RPC_URL)) {
  const users = new PgUserRepository(pool);
  const wallets = new PgWalletAccountRepository(pool);
  const cipher = new SecretCipher(env.WALLET_ENCRYPTION_KEY);
  const walletService = new WalletService(users, wallets, blockchain, cipher);
  const ledger = new LedgerService(pool);
  const withdrawalService = new WithdrawalService(pool, walletService, ledger, new WalletKeyStore(wallets, cipher), blockchain, {
    enabled: env.WITHDRAWALS_ENABLED,
    accessCode: env.WITHDRAWAL_ACCESS_CODE,
    maxLamports: env.WITHDRAWAL_MAX_SOL,
  });
  const depositSync = new DepositSyncService(pool, walletService, ledger, blockchain, withdrawalService);
  const accountService = new AccountService(pool, walletService, ledger, blockchain, depositSync, withdrawalService);

  const healthCheck = async (): Promise<HealthDto> => {
    const [database, solana] = await Promise.all([
      pool.query('SELECT 1').then(() => 'up' as const, () => 'down' as const),
      blockchain.getNetworkStatus().then(
        (s) => ({ status: 'up' as const, slot: s.slot, version: s.version }),
        () => ({ status: 'down' as const }),
      ),
    ]);
    return {
      status: database === 'up' && solana.status === 'up' ? 'ok' : 'degraded',
      database,
      solana: { network: SOLANA_NETWORK, rpcUrl: env.SOLANA_RPC_URL, ...solana },
      timestamp: new Date().toISOString(),
    };
  };

  const ensureDatabaseReady = env.DB_AUTO_MIGRATE
    ? createDatabaseBootstrap(pool, { demoUserId: env.DEMO_USER_ID })
    : async () => undefined;

  return {
    users,
    wallets,
    blockchain,
    ledger,
    walletService,
    withdrawalService,
    depositSync,
    accountService,
    healthCheck,
    ensureDatabaseReady,
  };
}

/**
 * Builds the HTTP app for a runtime (long-running server or Vercel Function).
 * The authentication middleware is chosen here — replace DemoUserMiddleware
 * with the client's JWT/session middleware when integrating.
 */
export function createHttpApp(env: Env, container: ReturnType<typeof createContainer>) {
  const demoUser = demoUserMiddleware(env.DEMO_USER_ID);
  // Database readiness runs first so a fresh database (e.g. a new deployment)
  // gets its schema and demo user before any wallet request touches it.
  const authenticate: RequestHandler = async (req, res, next) => {
    await container.ensureDatabaseReady();
    demoUser(req, res, next);
  };
  return createApp({
    ...container,
    authenticate,
    corsOrigin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
  });
}
