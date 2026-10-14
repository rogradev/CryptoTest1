import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/createApp.js';
import { demoUserMiddleware } from '../src/middleware/demoUser.js';
import { SecretCipher } from '../src/lib/secretCipher.js';
import { WalletService } from '../src/services/walletService.js';
import type { AccountService } from '../src/services/accountService.js';
import type { WithdrawalPolicy, WithdrawalService } from '../src/services/withdrawalService.js';
import {
  InMemoryUserRepository,
  InMemoryWalletAccountRepository,
  MockBlockchainProvider,
  testKey,
} from './helpers.js';

const USER = 'demo-user-001';

/**
 * HTTP-layer tests: routing, validation, the withdrawal gate and response
 * shapes. Ledger/withdrawal/deposit services are stubbed here; their real
 * behavior is covered by the PostgreSQL suites (*.int.test.ts).
 */
function buildApp(policy: Partial<WithdrawalPolicy> = {}) {
  const users = new InMemoryUserRepository([USER]);
  const wallets = new InMemoryWalletAccountRepository();
  const chain = new MockBlockchainProvider();
  const walletService = new WalletService(users, wallets, chain, new SecretCipher(testKey()));
  const requests: { body: unknown; key: string }[] = [];
  const withdrawalService = {
    policy: { enabled: true, accessCode: 'demo-code-123', maxLamports: 1_000_000_000n, ...policy },
    validate: async (_userId: string, body: { destinationAddress: string }) => ({
      valid: false,
      destinationAddress: body.destinationAddress,
      amountLamports: null,
      estimatedFeeLamports: '5000',
      availableLamports: '0',
      issues: [{ field: 'destinationAddress', message: 'Not a valid Solana address' }],
      broadcastEnabled: true,
    }),
    request: async (_userId: string, body: unknown, key: string) => {
      requests.push({ body, key });
      return { id: '00000000-0000-4000-8000-000000000001', status: 'broadcast' };
    },
    get: async () => ({ id: '00000000-0000-4000-8000-000000000001', status: 'completed' }),
  } as unknown as WithdrawalService;
  const accountService = {
    getOverview: async () => ({ available: { lamports: '0', sol: '0.000000000' } }),
    getActivity: async () => [{ id: 'a', kind: 'deposit', amountLamports: '5000000000', status: 'confirmed' }],
  } as unknown as AccountService;
  const app = createApp({
    users,
    walletService,
    withdrawalService,
    accountService,
    authenticate: demoUserMiddleware(USER),
    corsOrigin: 'http://localhost:5173',
    healthCheck: async () => ({
      status: 'ok',
      database: 'up',
      solana: { network: 'solana-devnet', status: 'up', rpcUrl: 'mock' },
      timestamp: new Date().toISOString(),
    }),
  });
  return { app, chain, wallets, requests };
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

    const missing = await request(ctx.app).post('/api/wallet/withdrawals/validate').send({});
    expect(missing.status).toBe(400);

    const malformed = await request(ctx.app).post('/api/wallet/withdrawals/validate').set('content-type', 'application/json').send('{bad');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('BAD_REQUEST');
  });

  describe('POST /api/wallet/withdrawals (demo safety gate)', () => {
    const body = { destinationAddress: 'x', amountSol: '0.1' };
    const send = (app: typeof ctx.app, headers: Record<string, string>) => {
      let req = request(app).post('/api/wallet/withdrawals');
      for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
      return req.send(body);
    };

    it('is refused when withdrawals are disabled', async () => {
      const disabled = buildApp({ enabled: false });
      const res = await send(disabled.app, { 'X-Withdrawal-Access-Code': 'demo-code-123', 'Idempotency-Key': 'key-12345678' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('WITHDRAWALS_DISABLED');
      expect(disabled.requests).toHaveLength(0);
    });

    it('requires the access code and rejects a wrong one', async () => {
      expect((await send(ctx.app, { 'Idempotency-Key': 'key-12345678' })).status).toBe(401);
      const wrong = await send(ctx.app, { 'X-Withdrawal-Access-Code': 'nope', 'Idempotency-Key': 'key-12345678' });
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.code).toBe('WITHDRAWAL_ACCESS_DENIED');
      expect(ctx.requests).toHaveLength(0);
    });

    it('locks a client out after repeated wrong codes, even if it later sends the right one', async () => {
      for (let i = 0; i < 5; i++) await send(ctx.app, { 'X-Withdrawal-Access-Code': `wrong-${i}`, 'X-Real-IP': '9.9.9.9' });
      const locked = await send(ctx.app, {
        'X-Withdrawal-Access-Code': 'demo-code-123',
        'Idempotency-Key': 'key-12345678',
        'X-Real-IP': '9.9.9.9',
      });
      expect(locked.status).toBe(429);
      // Other clients are unaffected.
      const other = await send(ctx.app, {
        'X-Withdrawal-Access-Code': 'demo-code-123',
        'Idempotency-Key': 'key-12345678',
        'X-Real-IP': '1.1.1.1',
      });
      expect(other.status).toBe(202);
    });

    it('requires a well-formed Idempotency-Key', async () => {
      const none = await send(ctx.app, { 'X-Withdrawal-Access-Code': 'demo-code-123' });
      expect(none.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      const bad = await send(ctx.app, { 'X-Withdrawal-Access-Code': 'demo-code-123', 'Idempotency-Key': 'short' });
      expect(bad.status).toBe(400);
    });

    it('accepts with a valid code and key (202)', async () => {
      const res = await send(ctx.app, { 'X-Withdrawal-Access-Code': 'demo-code-123', 'Idempotency-Key': 'key-12345678' });
      expect(res.status).toBe(202);
      expect(res.body.data.status).toBe('broadcast');
      expect(ctx.requests).toEqual([{ body, key: 'key-12345678' }]);
    });

    it('runs without a code when none is configured (development)', async () => {
      const open = buildApp({ accessCode: null });
      expect((await send(open.app, { 'Idempotency-Key': 'key-12345678' })).status).toBe(202);
    });
  });

  it('GET /api/wallet/withdrawals/:id validates the id', async () => {
    expect((await request(ctx.app).get('/api/wallet/withdrawals/not-a-uuid')).status).toBe(400);
    const ok = await request(ctx.app).get('/api/wallet/withdrawals/00000000-0000-4000-8000-000000000001');
    expect(ok.body.data.status).toBe('completed');
  });

  it('GET /api/wallet/activity and /overview respond with the envelope', async () => {
    expect((await request(ctx.app).get('/api/wallet/activity?limit=5')).body.data.items).toHaveLength(1);
    expect((await request(ctx.app).get('/api/wallet/activity?limit=0')).status).toBe(400);
    expect((await request(ctx.app).get('/api/wallet/overview')).body.ok).toBe(true);
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(ctx.app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});
