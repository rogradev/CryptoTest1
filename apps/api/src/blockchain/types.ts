import type { SolanaNetwork, TransactionDirection, TransactionStatus } from '@wallet/shared';

/** A freshly generated keypair. `secretKey` must be encrypted immediately and then zeroed. */
export interface WalletResult {
  address: string;
  secretKey: Uint8Array;
}

/** Normalized on-chain transaction, independent of the underlying SDK. */
export interface BlockchainTransaction {
  signature: string;
  slot: number;
  blockTime: Date | null;
  status: TransactionStatus;
  direction: TransactionDirection;
  /** Signed net balance change for the wallet, in lamports. Null if unknown. */
  amountLamports: bigint | null;
  feeLamports: bigint | null;
}

export interface NetworkStatus {
  network: SolanaNetwork;
  slot: number;
  version: string;
  genesisHash: string;
}

/**
 * Boundary between application services and a blockchain SDK.
 * Controllers and services never import @solana/web3.js directly.
 *
 * Planned additions (next milestone), without changing callers:
 *   sendTransaction(params): Promise<string>
 *   getTransaction(signature): Promise<BlockchainTransaction | null>
 *   detectDeposits(address, sinceSignature?): Promise<BlockchainTransaction[]>
 */
export interface BlockchainProvider {
  readonly network: SolanaNetwork;
  createWallet(): Promise<WalletResult>;
  isValidAddress(address: string): boolean;
  getBalance(address: string): Promise<bigint>;
  getRecentTransactions(address: string, limit?: number): Promise<BlockchainTransaction[]>;
  getNetworkStatus(): Promise<NetworkStatus>;
  explorerUrl(kind: 'address' | 'tx', value: string): string;
}
