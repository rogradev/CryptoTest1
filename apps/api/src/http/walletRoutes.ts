import { Router } from 'express';
import { z } from 'zod';
import {
  lamportsToSol,
  type CurrentUserDto,
  type DepositAddressDto,
  type OnChainBalanceDto,
  type TransactionListDto,
  type WalletDto,
} from '@wallet/shared';
import { Errors } from '../lib/errors.js';
import { requireUserId } from '../middleware/auth.js';
import type { UserRepository } from '../repositories/userRepository.js';
import type { WalletAccount } from '../repositories/walletAccountRepository.js';
import type { WalletService } from '../services/walletService.js';
import type { WithdrawalService } from '../services/withdrawalService.js';
import { ok } from './respond.js';

const transactionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

const withdrawalValidationBody = z.object({
  destinationAddress: z.string().trim().min(1, 'Destination address is required').max(64),
  amountSol: z.string().trim().min(1, 'Amount is required').max(32),
});

export interface WalletRouteDeps {
  walletService: WalletService;
  withdrawalService: WithdrawalService;
  users: UserRepository;
}

export function walletRoutes({ walletService, withdrawalService, users }: WalletRouteDeps): Router {
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
    const body = withdrawalValidationBody.parse(req.body);
    ok(res, await withdrawalService.validate(requireUserId(req), body));
  });

  // Explicit placeholder: broadcasting is the next milestone. Never fake success.
  router.post('/wallet/withdrawals', () => {
    throw Errors.notImplemented('Withdrawal broadcasting is not enabled in this checkpoint (next milestone).');
  });

  return router;
}
