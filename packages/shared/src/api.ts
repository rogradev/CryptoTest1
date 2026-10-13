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
  availableLamports: string;
  issues: { field: 'destinationAddress' | 'amountSol'; message: string }[];
  /** Withdrawal broadcasting is not enabled in this checkpoint. */
  broadcastEnabled: false;
}
