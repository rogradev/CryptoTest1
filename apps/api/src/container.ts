import type pg from 'pg';
import { SOLANA_NETWORK, type HealthDto } from '@wallet/shared';
import type { Env } from './config/env.js';
import { createApp } from './createApp.js';
import { SolanaDevnetProvider } from './blockchain/solanaDevnetProvider.js';
import type { BlockchainProvider } from './blockchain/types.js';
import { SecretCipher } from './lib/secretCipher.js';
import { demoUserMiddleware } from './middleware/demoUser.js';
import { PgUserRepository } from './repositories/userRepository.js';
import { PgWalletAccountRepository } from './repositories/walletAccountRepository.js';
import { WalletService } from './services/walletService.js';
import { WithdrawalService } from './services/withdrawalService.js';

/** Composition root: wires infrastructure into application services. */
export function createContainer(env: Env, pool: pg.Pool, blockchain: BlockchainProvider = new SolanaDevnetProvider(env.SOLANA_RPC_URL)) {
  const users = new PgUserRepository(pool);
  const wallets = new PgWalletAccountRepository(pool);
  const walletService = new WalletService(users, wallets, blockchain, new SecretCipher(env.WALLET_ENCRYPTION_KEY));
  const withdrawalService = new WithdrawalService(walletService, blockchain);

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

  return { users, wallets, blockchain, walletService, withdrawalService, healthCheck };
}

/**
 * Builds the HTTP app for a runtime (long-running server or Vercel Function).
 * The authentication middleware is chosen here — replace DemoUserMiddleware
 * with the client's JWT/session middleware when integrating.
 */
export function createHttpApp(env: Env, container: ReturnType<typeof createContainer>) {
  return createApp({
    ...container,
    authenticate: demoUserMiddleware(env.DEMO_USER_ID),
    corsOrigin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
  });
}
