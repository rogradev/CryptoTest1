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

  const server = app.listen(env.PORT, () => {
    logger.info('Wallet API listening', { port: env.PORT, network: 'solana-devnet', authMode: 'demo' });
  });

  const shutdown = () => {
    logger.info('Shutting down');
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
