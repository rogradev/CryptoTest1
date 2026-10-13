import type { Database } from '../db/pool.js';

export interface User {
  id: string;
  displayName: string | null;
  createdAt: Date;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
}

export class PgUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.db.query<{ id: string; display_name: string | null; created_at: Date }>(
      'SELECT id, display_name, created_at FROM users WHERE id = $1',
      [id],
    );
    const row = rows[0];
    return row ? { id: row.id, displayName: row.display_name, createdAt: row.created_at } : null;
  }
}
