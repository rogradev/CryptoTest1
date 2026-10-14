import { Router } from 'express';
import { z } from 'zod';
import {
  lamportsToSol,
  type ActivityListDto,
  type CurrentUserDto,
  type DepositAddressDto,
  type OnChainBalanceDto,
  type TransactionListDto,
  type WalletDto,
} from '@wallet/shared';
import { Errors } from '../lib/errors.js';
import { requireUserId } from '../middleware/auth.js';
import { withdrawalAccessGate } from '../middleware/withdrawalAccess.js';
import type { UserRepository } from '../repositories/userRepository.js';
import type { AccountService } from '../services/accountService.js';
import type { WalletAccount } from '../repositories/walletAccountRepository.js';
import type { WalletService } from '../services/walletService.js';
import type { WithdrawalService } from '../services/withdrawalService.js';
import { ok } from './respond.js';

const transactionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

const withdrawalBody = z.object({
  destinationAddress: z.string().trim().min(1, 'Destination address is required').max(64),
  amountSol: z.string().trim().min(1, 'Amount is required').max(32),
});

const activityQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const idempotencyKey = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key must be 8-100 characters [A-Za-z0-9_-]');

const withdrawalIdParams = z.object({ id: z.uuid('Invalid withdrawal id') });

export interface WalletRouteDeps {
  walletService: WalletService;
  withdrawalService: WithdrawalService;
  accountService: AccountService;
  users: UserRepository;
}

export function walletRoutes({ walletService, withdrawalService, accountService, users }: WalletRouteDeps): Router {
  const router = Router();

  const toWalletDto = (wallet: WalletAccount): WalletDto => ({
    id: wallet.id,
    userId: wallet.userId,
    network: wallet.network,
    asset: 'SOL',
    address: wallet.address,
    createdAt: wallet.createdAt.toISOString(),
    explorerUrl: walletService.explorerUrl('address', wallet.address),
  });

  router.get('/me', async (req, res) => {
    const userId = requireUserId(req);
    const user = await users.findById(userId);
    if (!user) throw Errors.userNotFound(userId);
    ok<CurrentUserDto>(res, { id: user.id, displayName: user.displayName, authMode: req.user?.authMode ?? 'external' });
  });

  router.get('/wallet', async (req, res) => {
    const wallet = await walletService.getOrCreateWallet(requireUserId(req));
    ok<WalletDto>(res, toWalletDto(wallet));
  });

  /** Ledger balance (source of truth) + on-chain diagnostics; also drives deposit sync. */
  router.get('/wallet/overview', async (req, res) => {
    ok(res, await accountService.getOverview(requireUserId(req)));
  });

  /** Forces a deposit/withdrawal sync now (throttled to once per second). */
  router.post('/wallet/sync', async (req, res) => {
    ok(res, await accountService.getOverview(requireUserId(req), { forceSync: true }));
  });

  /** User-facing history from the deposits and withdrawals tables. */
  router.get('/wallet/activity', async (req, res) => {
    const { limit } = activityQuery.parse(req.query);
    const items = await accountService.getActivity(requireUserId(req), limit);
    ok<ActivityListDto>(res, { network: 'solana-devnet', items });
  });

  /** Raw on-chain balance of the custodial wallet (diagnostics). */
  router.get('/wallet/balance', async (req, res) => {
    const { wallet, lamports, fetchedAt } = await walletService.getOnChainBalance(requireUserId(req));
    ok<OnChainBalanceDto>(res, {
      network: wallet.network,
      address: wallet.address,
      source: 'on-chain',
      balanceLamports: lamports.toString(),
      balanceSol: lamportsToSol(lamports),
      fetchedAt: fetchedAt.toISOString(),
    });
  });

  router.get('/wallet/deposit-address', async (req, res) => {
    const wallet = await walletService.getOrCreateWallet(requireUserId(req));
    ok<DepositAddressDto>(res, {
      network: wallet.network,
      asset: 'SOL',
      address: wallet.address,
      paymentUri: `solana:${wallet.address}`,
      explorerUrl: walletService.explorerUrl('address', wallet.address),
      warning: 'Send only Solana DEVNET SOL to this address. Devnet tokens have no monetary value.',
    });
  });

  /** Raw on-chain transaction list (diagnostics); the UI uses /wallet/activity. */
  router.get('/wallet/transactions', async (req, res) => {
    const { limit } = transactionsQuery.parse(req.query);
    const { wallet, transactions } = await walletService.getRecentOnChainTransactions(requireUserId(req), limit);
    ok<TransactionListDto>(res, {
      network: wallet.network,
      address: wallet.address,
      source: 'on-chain',
      transactions: transactions.map((tx) => ({
        signature: tx.signature,
        direction: tx.direction,
        amountLamports: tx.amountLamports?.toString() ?? null,
        feeLamports: tx.feeLamports?.toString() ?? null,
        slot: tx.slot,
        blockTime: tx.blockTime?.toISOString() ?? null,
        status: tx.status,
        explorerUrl: walletService.explorerUrl('tx', tx.signature),
      })),
    });
  });

  router.post('/wallet/withdrawals/validate', async (req, res) => {
    const body = withdrawalBody.parse(req.body);
    ok(res, await withdrawalService.validate(requireUserId(req), body));
  });

  /** Executes a real Devnet withdrawal. Gated by WITHDRAWALS_ENABLED + demo access code. */
  router.post('/wallet/withdrawals', withdrawalAccessGate(withdrawalService.policy), async (req, res) => {
    const key = req.get('idempotency-key');
    if (!key) throw Errors.idempotencyKeyRequired();
    const parsedKey = idempotencyKey.parse(key);
    const body = withdrawalBody.parse(req.body);
    ok(res, await withdrawalService.request(requireUserId(req), body, parsedKey), 202);
  });

  router.get('/wallet/withdrawals/:id', async (req, res) => {
    const { id } = withdrawalIdParams.parse(req.params);
    ok(res, await withdrawalService.get(requireUserId(req), id));
  });

  return router;
}
