import { randomBytes } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import type { BlockchainProvider, BlockchainTransaction, WalletResult } from '../src/blockchain/types.js';
import { SecretCipher } from '../src/lib/secretCipher.js';
import type { User, UserRepository } from '../src/repositories/userRepository.js';
import type {
  NewWalletAccount,
  WalletAccount,
  WalletAccountRepository,
} from '../src/repositories/walletAccountRepository.js';
import type { SolanaNetwork } from '@wallet/shared';

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

/** Solana mock — generates real keypairs locally but never touches the network. */
export class MockBlockchainProvider implements BlockchainProvider {
  readonly network = 'solana-devnet' as const;
  balances = new Map<string, bigint>();
  transactions: BlockchainTransaction[] = [];
  createdWallets = 0;
  lastSecretKey: Uint8Array | null = null;

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
}

export const testKey = () => randomBytes(32);
export const testCipher = () => new SecretCipher(testKey());
