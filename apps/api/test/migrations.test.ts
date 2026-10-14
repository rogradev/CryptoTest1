import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/db/migrations.generated.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/migrations');

describe('embedded migrations', () => {
  it('match database/migrations/*.sql exactly (run `npm run db:embed -w @wallet/api` if this fails)', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    expect(MIGRATIONS.map((m) => m.name)).toEqual(files);
    for (const migration of MIGRATIONS) {
      expect(migration.sql).toBe(readFileSync(path.join(migrationsDir, migration.name), 'utf8'));
    }
  });
});
