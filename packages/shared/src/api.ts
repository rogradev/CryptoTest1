/**
 * API contract shared by the Express API and the React client.
 * Amounts are always transported as lamport strings (JSON has no bigint).
 */

export const SOLANA_NETWORK = 'solana-devnet' as const;
export type SolanaNetwork = typeof SOLANA_NETWORK;

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface HealthDto {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  solana: {
    network: SolanaNetwork;
    status: 'up' | 'down';
    rpcUrl: string;
    slot?: number;
    version?: string;
  };
  timestamp: string;
}

export interface CurrentUserDto {
  id: string;
  displayName: string | null;
  /** "demo" while the temporary DemoUserMiddleware is in use. */
  authMode: 'demo' | 'external';
}

export interface WalletDto {
  id: string;
  userId: string;
  network: SolanaNetwork;
  asset: 'SOL';
  address: string;
  createdAt: string;
  explorerUrl: string;
}

/** Live balance read directly from the blockchain (NOT the internal ledger). */
export interface OnChainBalanceDto {
  network: SolanaNetwork;
  address: string;
  source: 'on-chain';
  balanceLamports: string;
  balanceSol: string;
  fetchedAt: string;
}

export interface DepositAddressDto {
  network: SolanaNetwork;
  asset: 'SOL';
  address: string;
  /** Solana Pay style URI (solana:<address>) for wallet apps. */
  paymentUri: string;
  explorerUrl: string;
  warning: string;
}

export type TransactionDirection = 'inbound' | 'outbound' | 'self' | 'unknown';
export type TransactionStatus = 'processed' | 'confirmed' | 'finalized' | 'failed';

export interface TransactionDto {
  signature: string;
  direction: TransactionDirection;
  /** Net change for the wallet in lamports (signed). Null if it could not be determined. */
  amountLamports: string | null;
  feeLamports: string | null;
  slot: number;
  blockTime: string | null;
  status: TransactionStatus;
  explorerUrl: string;
}

export interface TransactionListDto {
  network: SolanaNetwork;
  address: string;
  source: 'on-chain';
  transactions: TransactionDto[];
}

export interface WithdrawalValidationRequest {
  destinationAddress: string;
  amountSol: string;
}

export interface WithdrawalValidationDto {
  valid: boolean;
  destinationAddress: string;
  amountLamports: string | null;
  estimatedFeeLamports: string;
  /** Internal ledger balance available for withdrawal. */
  availableLamports: string;
  issues: { field: 'destinationAddress' | 'amountSol'; message: string }[];
  /** Whether this deployment executes withdrawals (WITHDRAWALS_ENABLED). */
  broadcastEnabled: boolean;
}

export interface WithdrawalRequest {
  destinationAddress: string;
  amountSol: string;
}

export interface WithdrawalPolicyDto {
  enabled: boolean;
  /** A demo access code must be sent in the X-Withdrawal-Access-Code header. */
  accessCodeRequired: boolean;
  maxLamports: string;
  estimatedFeeLamports: string;
}

export interface AmountDto {
  lamports: string;
  sol: string;
}

/** Wallet overview: internal ledger balance first, on-chain balance for diagnostics. */
export interface WalletOverviewDto {
  network: SolanaNetwork;
  address: string;
  /** Internal ledger balance: SUM(ledger_entries). Source of truth for the app. */
  available: AmountDto;
  /** Live on-chain balance of the custodial wallet. Null if the RPC is unreachable. */
  onChain: AmountDto | null;
  pending: {
    /** Deposits detected but not yet finalized (not yet credited). */
    incomingLamports: string;
    /** Withdrawals reserved/in flight (already deducted from available). */
    outgoingLamports: string;
  };
  withdrawals: WithdrawalPolicyDto;
  sync: { status: 'ok' | 'skipped' | 'error'; message?: string; lastSyncedAt: string | null };
}

export type DepositStatus = 'detected' | 'confirming' | 'confirmed' | 'failed';
export type WithdrawalStatus =
  | 'pending'
  | 'processing'
  | 'broadcast'
  | 'confirming'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WithdrawalDto {
  id: string;
  destinationAddress: string;
  amountLamports: string;
  feeLamports: string | null;
  status: WithdrawalStatus;
  signature: string | null;
  explorerUrl: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** One user-facing history row, backed by the deposits / withdrawals tables. */
export interface ActivityItemDto {
  id: string;
  kind: 'deposit' | 'withdrawal';
  /** Signed from the user's perspective: deposits > 0, withdrawals < 0. */
  amountLamports: string;
  feeLamports: string | null;
  status: DepositStatus | WithdrawalStatus;
  signature: string | null;
  explorerUrl: string | null;
  counterparty: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface ActivityListDto {
  network: SolanaNetwork;
  items: ActivityItemDto[];
}
