import type { SolanaNetwork } from '@wallet/shared';
import type { Database } from '../db/pool.js';

/** Public view of a wallet account. Deliberately excludes secret material. */
export interface WalletAccount {
  id: string;
  userId: string;
  network: SolanaNetwork;
  address: string;
  createdAt: Date;
}

export interface NewWalletAccount {
  userId: string;
  network: SolanaNetwork;
  address: string;
  encryptedSecret: string;
}

export interface WalletAccountRepository {
  findByUser(userId: string, network: SolanaNetwork): Promise<WalletAccount | null>;
  /**
   * Inserts the wallet unless the user already has one on this network.
   * Returns the persisted wallet — the existing one if a concurrent request won.
   */
  createIfAbsent(input: NewWalletAccount): Promise<WalletAccount>;
  /** Only for the future signing path (withdrawals). Never returned over HTTP. */
  getEncryptedSecret(walletAccountId: string): Promise<string | null>;
}

type WalletRow = { id: string; user_id: string; network: SolanaNetwork; address: string; created_at: Date };

const toWallet = (row: WalletRow): WalletAccount => ({
  id: row.id,
  userId: row.user_id,
  network: row.network,
  address: row.address,
  createdAt: row.created_at,
});

const PUBLIC_COLUMNS = 'id, user_id, network, address, created_at';

export class PgWalletAccountRepository implements WalletAccountRepository {
  constructor(private readonly db: Database) {}

  async findByUser(userId: string, network: SolanaNetwork): Promise<WalletAccount | null> {
    const { rows } = await this.db.query<WalletRow>(
      `SELECT ${PUBLIC_COLUMNS} FROM wallet_accounts WHERE user_id = $1 AND network = $2`,
      [userId, network],
    );
    return rows[0] ? toWallet(rows[0]) : null;
  }

  async createIfAbsent(input: NewWalletAccount): Promise<WalletAccount> {
    const { rows } = await this.db.query<WalletRow>(
      `INSERT INTO wallet_accounts (user_id, network, address, encrypted_secret)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, network) DO NOTHING
       RETURNING ${PUBLIC_COLUMNS}`,
      [input.userId, input.network, input.address, input.encryptedSecret],
    );
    if (rows[0]) return toWallet(rows[0]);
    const existing = await this.findByUser(input.userId, input.network);
    if (!existing) throw new Error('Wallet insert conflicted but no existing wallet was found');
    return existing;
  }

  async getEncryptedSecret(walletAccountId: string): Promise<string | null> {
    const { rows } = await this.db.query<{ encrypted_secret: string }>(
      'SELECT encrypted_secret FROM wallet_accounts WHERE id = $1',
      [walletAccountId],
    );
    return rows[0]?.encrypted_secret ?? null;
  }
}
