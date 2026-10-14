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

export type CommitmentStatus = 'processed' | 'confirmed' | 'finalized';

/** Entry from an address's signature history (newest first). */
export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: Date | null;
  status: CommitmentStatus;
  failed: boolean;
}

/** A native SOL transfer (System Program transfer) inside a transaction. */
export interface NativeTransfer {
  source: string;
  destination: string;
  lamports: bigint;
}

/** SDK-independent view of one transaction. */
export interface TransactionDetails {
  signature: string;
  slot: number;
  blockTime: Date | null;
  failed: boolean;
  feeLamports: bigint;
  feePayer: string;
  /** Top-level and inner System Program transfers. */
  transfers: NativeTransfer[];
}

export interface SignatureStatus {
  status: CommitmentStatus;
  failed: boolean;
  error: string | null;
}

export interface SignedTransfer {
  signature: string;
  /** Wire-format transaction, ready for sendRawTransaction. */
  serialized: Uint8Array;
  /** The transaction cannot land after the chain passes this block height. */
  lastValidBlockHeight: number;
}

/** The RPC node rejected the transaction (e.g. preflight simulation failed): it will never land. */
export class TransactionRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionRejectedError';
  }
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
 */
export interface BlockchainProvider {
  readonly network: SolanaNetwork;
  createWallet(): Promise<WalletResult>;
  isValidAddress(address: string): boolean;
  getBalance(address: string): Promise<bigint>;
  /** Raw chain view (diagnostics). The wallet UI uses the stored history instead. */
  getRecentTransactions(address: string, limit?: number): Promise<BlockchainTransaction[]>;
  getNetworkStatus(): Promise<NetworkStatus>;
  explorerUrl(kind: 'address' | 'tx', value: string): string;

  // --- deposit detection ---------------------------------------------
  getRecentSignatures(address: string, limit: number): Promise<SignatureInfo[]>;
  /** Null when the transaction is not (yet) visible at `confirmed` commitment. */
  getTransaction(signature: string): Promise<TransactionDetails | null>;
  /** Null entries for signatures the cluster does not know (yet). */
  getSignatureStatuses(signatures: string[]): Promise<Map<string, SignatureStatus | null>>;

  // --- withdrawals ----------------------------------------------------
  getBlockHeight(): Promise<number>;
  /** Minimum balance for a rent-exempt system account with no data. */
  getMinimumBalanceForRentExemption(): Promise<bigint>;
  /** Builds and signs a native SOL transfer. Does not send it. */
  createSignedTransfer(params: { secretKey: Uint8Array; destination: string; lamports: bigint }): Promise<SignedTransfer>;
  /** Sends a signed transaction. Throws TransactionRejectedError when it can never land. */
  sendRawTransaction(serialized: Uint8Array): Promise<string>;
}
