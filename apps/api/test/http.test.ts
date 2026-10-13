import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/createApp.js';
import { demoUserMiddleware } from '../src/middleware/demoUser.js';
import { SecretCipher } from '../src/lib/secretCipher.js';
import { WalletService } from '../src/services/walletService.js';
import { WithdrawalService } from '../src/services/withdrawalService.js';
import {
  InMemoryUserRepository,
  InMemoryWalletAccountRepository,
  MockBlockchainProvider,
  testKey,
} from './helpers.js';

const USER = 'demo-user-001';

function buildApp() {
  const users = new InMemoryUserRepository([USER]);
  const wallets = new InMemoryWalletAccountRepository();
  const chain = new MockBlockchainProvider();
  const walletService = new WalletService(users, wallets, chain, new SecretCipher(testKey()));
  const app = createApp({
    users,
    walletService,
    withdrawalService: new WithdrawalService(walletService, chain),
    authenticate: demoUserMiddleware(USER),
    corsOrigin: 'http://localhost:5173',
    healthCheck: async () => ({
      status: 'ok',
      database: 'up',
      solana: { network: 'solana-devnet', status: 'up', rpcUrl: 'mock' },
      timestamp: new Date().toISOString(),
    }),
  });
  return { app, chain, wallets };
}

describe('HTTP API', () => {
  let ctx: ReturnType<typeof buildApp>;
  beforeEach(() => {
    ctx = buildApp();
  });

  it('GET /api/health', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: { status: 'ok' } });
  });

  it('GET /api/me returns the demo user', async () => {
    const res = await request(ctx.app).get('/api/me');
    expect(res.body.data).toEqual({ id: USER, displayName: 'Demo User', authMode: 'demo' });
  });

  it('GET /api/wallet returns a stable wallet and never exposes secret material', async () => {
    const first = await request(ctx.app).get('/api/wallet');
    const second = await request(ctx.app).get('/api/wallet');
    expect(first.status).toBe(200);
    expect(first.body.data.network).toBe('solana-devnet');
    expect(second.body.data.address).toBe(first.body.data.address);

    const envelope = ctx.wallets.rows[0]!.encryptedSecret;
    const raw = JSON.stringify(first.body);
    expect(raw).not.toContain(envelope);
    expect(raw).not.toMatch(/secret/i);
  });

  it('GET /api/wallet/balance returns lamports as string and exact SOL', async () => {
    const { body: wallet } = await request(ctx.app).get('/api/wallet');
    ctx.chain.balances.set(wallet.data.address, 1_000_000_000n);
    const res = await request(ctx.app).get('/api/wallet/balance');
    expect(res.body.data).toMatchObject({
      network: 'solana-devnet',
      address: wallet.data.address,
      source: 'on-chain',
      balanceLamports: '1000000000',
      balanceSol: '1.000000000',
    });
  });

  it('GET /api/wallet/deposit-address', async () => {
    const res = await request(ctx.app).get('/api/wallet/deposit-address');
    expect(res.body.data.paymentUri).toBe(`solana:${res.body.data.address}`);
    expect(res.body.data.explorerUrl).toContain('cluster=devnet');
  });

  it('GET /api/wallet/transactions maps chain data and validates the query', async () => {
    ctx.chain.transactions = [
      { signature: 'sig1', slot: 10, blockTime: new Date(0), status: 'finalized', direction: 'inbound', amountLamports: 2_000_000_000n, feeLamports: 5000n },
    ];
    const res = await request(ctx.app).get('/api/wallet/transactions?limit=5');
    expect(res.body.data.transactions[0]).toMatchObject({ signature: 'sig1', amountLamports: '2000000000', direction: 'inbound' });

    const bad = await request(ctx.app).get('/api/wallet/transactions?limit=500');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/wallet/withdrawals/validate validates input with Zod', async () => {
    const res = await request(ctx.app).post('/api/wallet/withdrawals/validate').send({ destinationAddress: 'bad', amountSol: '1' });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.broadcastEnabled).toBe(false);

    const missing = await request(ctx.app).post('/api/wallet/withdrawals/validate').send({});
    expect(missing.status).toBe(400);

    const malformed = await request(ctx.app).post('/api/wallet/withdrawals/validate').set('content-type', 'application/json').send('{bad');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('BAD_REQUEST');
  });

  it('POST /api/wallet/withdrawals is honestly not implemented yet', async () => {
    const res = await request(ctx.app).post('/api/wallet/withdrawals').send({});
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(ctx.app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});
