import { randomBytes } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  TransactionRejectedError,
  type BlockchainProvider,
  type BlockchainTransaction,
  type CommitmentStatus,
  type SignatureInfo,
  type SignatureStatus,
  type SignedTransfer,
  type TransactionDetails,
  type WalletResult,
} from '../src/blockchain/types.js';
import { Errors } from '../src/lib/errors.js';
import { SecretCipher } from '../src/lib/secretCipher.js';
import type { User, UserRepository } from '../src/repositories/userRepository.js';
import type {
  NewWalletAccount,
  WalletAccount,
  WalletAccountRepository,
} from '../src/repositories/walletAccountRepository.js';
import { base58Encode, type SolanaNetwork } from '@wallet/shared';

export class InMemoryUserRepository implements UserRepository {
  users = new Map<string, User>();
  constructor(ids: string[] = ['demo-user-001']) {
    for (const id of ids) this.users.set(id, { id, displayName: 'Demo User', createdAt: new Date() });
  }
  async findById(id: string) {
    return this.users.get(id) ?? null;
  }
}

export class InMemoryWalletAccountRepository implements WalletAccountRepository {
  rows: (WalletAccount & { encryptedSecret: string })[] = [];
  #find(userId: string, network: SolanaNetwork): WalletAccount | null {
    const row = this.rows.find((r) => r.userId === userId && r.network === network);
    if (!row) return null;
    return { id: row.id, userId: row.userId, network: row.network, address: row.address, createdAt: row.createdAt };
  }
  async findByUser(userId: string, network: SolanaNetwork) {
    return this.#find(userId, network);
  }
  /** Atomic like the SQL ON CONFLICT DO NOTHING insert. */
  async createIfAbsent(input: NewWalletAccount) {
    const existing = this.#find(input.userId, input.network);
    if (existing) return existing;
    this.rows.push({ id: `wallet-${this.rows.length + 1}`, createdAt: new Date(), ...input });
    return this.#find(input.userId, input.network)!;
  }
  async getEncryptedSecret(id: string) {
    return this.rows.find((r) => r.id === id)?.encryptedSecret ?? null;
  }
}

export const randomSignature = () => base58Encode(randomBytes(64));
export const randomAddress = () => Keypair.generate().publicKey.toBase58();

/**
 * Solana mock — an in-memory fake chain. Generates real keypairs locally but
 * never touches the network. Tests inject transfers, move signatures through
 * commitment levels and choose how broadcasts behave.
 */
export class MockBlockchainProvider implements BlockchainProvider {
  readonly network = 'solana-devnet' as const;
  balances = new Map<string, bigint>();
  transactions: BlockchainTransaction[] = [];
  createdWallets = 0;
  lastSecretKey: Uint8Array | null = null;

  // fake chain state
  history = new Map<string, string[]>(); // address -> signatures, newest first
  details = new Map<string, TransactionDetails>();
  statuses = new Map<string, SignatureStatus>();
  blockHeight = 1_000;
  rentMinimum = 890_880n;
  fee = 5_000n;
  /** accept: lands at `confirmed`; reject: preflight failure; ambiguous: network error, never lands. */
  sendBehavior: 'accept' | 'reject' | 'ambiguous' = 'accept';
  signed = new Map<string, { from: string; destination: string; lamports: bigint }>();
  sentSignatures: string[] = [];

  /** Simulates a transfer landing on chain. Returns its signature. */
  addTransfer(p: {
    from: string;
    to: string;
    lamports: bigint;
    status?: CommitmentStatus;
    failed?: boolean;
    signature?: string;
  }): string {
    const signature = p.signature ?? randomSignature();
    const failed = p.failed ?? false;
    this.details.set(signature, {
      signature,
      slot: this.blockHeight,
      blockTime: new Date(),
      failed,
      feeLamports: this.fee,
      feePayer: p.from,
      transfers: [{ source: p.from, destination: p.to, lamports: p.lamports }],
    });
    for (const address of [p.from, p.to]) this.history.set(address, [signature, ...(this.history.get(address) ?? [])]);
    this.statuses.set(signature, { status: p.status ?? 'finalized', failed, error: failed ? '{"InstructionError":[0,"Custom"]}' : null });
    this.balances.set(p.from, (this.balances.get(p.from) ?? 0n) - this.fee - (failed ? 0n : p.lamports));
    if (!failed) this.balances.set(p.to, (this.balances.get(p.to) ?? 0n) + p.lamports);
    return signature;
  }

  setStatus(signature: string, status: CommitmentStatus, failed = false) {
    this.statuses.set(signature, { status, failed, error: failed ? '{"InstructionError":[0,"Custom"]}' : null });
  }

  async createWallet(): Promise<WalletResult> {
    this.createdWallets++;
    const keypair = Keypair.generate();
    // Keypair#secretKey returns a fresh copy on each access; keep the one we hand out.
    const secretKey = keypair.secretKey;
    this.lastSecretKey = secretKey;
    return { address: keypair.publicKey.toBase58(), secretKey };
  }
  isValidAddress(address: string) {
    try {
      return new PublicKey(address).toBase58() === address;
    } catch {
      return false;
    }
  }
  async getBalance(address: string) {
    return this.balances.get(address) ?? 0n;
  }
  async getRecentTransactions() {
    return this.transactions;
  }
  async getNetworkStatus() {
    return { network: this.network, slot: 1, version: 'mock', genesisHash: 'mock' };
  }
  explorerUrl(kind: 'address' | 'tx', value: string) {
    return `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;
  }

  async getRecentSignatures(address: string, limit: number): Promise<SignatureInfo[]> {
    return (this.history.get(address) ?? []).slice(0, limit).flatMap((signature) => {
      const status = this.statuses.get(signature);
      const details = this.details.get(signature);
      if (!status || !details) return [];
      return [{ signature, slot: details.slot, blockTime: details.blockTime, status: status.status, failed: status.failed }];
    });
  }
  async getTransaction(signature: string) {
    return this.details.get(signature) ?? null;
  }
  async getSignatureStatuses(signatures: string[]) {
    return new Map(signatures.map((s) => [s, this.statuses.get(s) ?? null] as const));
  }
  async getBlockHeight() {
    return this.blockHeight;
  }
  async getMinimumBalanceForRentExemption() {
    return this.rentMinimum;
  }
  async createSignedTransfer(p: { secretKey: Uint8Array; destination: string; lamports: bigint }): Promise<SignedTransfer> {
    const from = Keypair.fromSecretKey(p.secretKey).publicKey.toBase58();
    const signature = randomSignature();
    this.signed.set(signature, { from, destination: p.destination, lamports: p.lamports });
    return { signature, serialized: new TextEncoder().encode(signature), lastValidBlockHeight: this.blockHeight + 150 };
  }
  async sendRawTransaction(serialized: Uint8Array): Promise<string> {
    const signature = new TextDecoder().decode(serialized);
    const transfer = this.signed.get(signature);
    if (!transfer) throw new Error('unknown transaction');
    if (this.sendBehavior === 'reject') throw new TransactionRejectedError('Simulation failed: insufficient funds');
    if (this.sendBehavior === 'ambiguous') throw Errors.blockchainUnavailable();
    this.sentSignatures.push(signature);
    this.addTransfer({ from: transfer.from, to: transfer.destination, lamports: transfer.lamports, status: 'confirmed', signature });
    return signature;
  }
}

export const testKey = () => randomBytes(32);
export const testCipher = () => new SecretCipher(testKey());
