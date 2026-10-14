import { EnvValidationError, loadEnv } from './config/env.js';
import { createContainer, createHttpApp } from './container.js';
import { createPool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { SolanaDevnetProvider } from './blockchain/solanaDevnetProvider.js';

async function main() {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  const blockchain = new SolanaDevnetProvider(env.SOLANA_RPC_URL);
  const container = createContainer(env, pool, blockchain);

  await pool.query('SELECT 1').catch((error: Error) => {
    throw new Error(`Cannot connect to PostgreSQL: ${error.message}`);
  });

  try {
    await blockchain.assertDevnet();
    logger.info('Connected to Solana Devnet', { rpcUrl: env.SOLANA_RPC_URL });
  } catch (error) {
    // Unreachable RPC is tolerated (health reports degraded); a non-devnet RPC is not.
    if (error instanceof Error && /not Solana Devnet/.test(error.message)) throw error;
    logger.warn('Solana Devnet RPC not reachable at startup — will retry on demand', { rpcUrl: env.SOLANA_RPC_URL });
  }

  const app = createHttpApp(env, container);

  // Long-running server: periodic deposit/withdrawal sync for all wallets.
  // (Serverless deployments sync on request instead — see AccountService.getOverview.)
  let syncTimer: NodeJS.Timeout | undefined;
  if (env.DEPOSIT_SYNC_INTERVAL_MS > 0) {
    let running = false;
    syncTimer = setInterval(() => {
      if (running) return;
      running = true;
      container
        .ensureDatabaseReady()
        .then(() => container.depositSync.syncAllWallets(env.DEPOSIT_SYNC_INTERVAL_MS / 2))
        .catch((error: unknown) =>
          logger.warn('Background sync failed', { error: error instanceof Error ? error.message : String(error) }),
        )
        .finally(() => {
          running = false;
        });
    }, env.DEPOSIT_SYNC_INTERVAL_MS);
    syncTimer.unref();
  }

  const server = app.listen(env.PORT, () => {
    logger.info('Wallet API listening', {
      port: env.PORT,
      network: 'solana-devnet',
      authMode: 'demo',
      withdrawals: env.WITHDRAWALS_ENABLED ? (env.WITHDRAWAL_ACCESS_CODE ? 'enabled (access code)' : 'enabled (open)') : 'disabled',
      depositSyncIntervalMs: env.DEPOSIT_SYNC_INTERVAL_MS,
    });
  });

  const shutdown = () => {
    logger.info('Shutting down');
    clearInterval(syncTimer);
    server.close(() => void pool.end().then(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    console.error(`\n${error.message}\n\nSee .env.example (or run \`npm run setup:env\`).\n`);
  } else {
    logger.error('Failed to start API', { error: error instanceof Error ? error.message : String(error) });
  }
  process.exit(1);
});
