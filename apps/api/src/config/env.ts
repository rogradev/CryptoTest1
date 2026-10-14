import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Environment configuration, validated once at startup.
 *
 * Safety rule: this checkpoint is DEVNET ONLY. Any other cluster, or an RPC
 * URL that points at mainnet, is rejected before the server starts. The
 * Solana provider additionally verifies the devnet genesis hash at runtime.
 */

const ENCRYPTION_KEY_BYTES = 32;

export function decodeEncryptionKey(raw: string): Buffer | null {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === ENCRYPTION_KEY_BYTES ? decoded : null;
  }
  return null;
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required' })
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL must be a postgresql:// connection string'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SOLANA_RPC_URL: z
    .url({ protocol: /^https?$/, error: 'SOLANA_RPC_URL must be an http(s) URL' })
    .default('https://api.devnet.solana.com')
    .refine((v) => !/mainnet/i.test(v), 'SOLANA_RPC_URL appears to point at mainnet — only devnet is allowed'),
  SOLANA_CLUSTER: z
    .string()
    .default('devnet')
    .refine((v) => v === 'devnet', 'SOLANA_CLUSTER must be "devnet" — this prototype never connects to mainnet'),
  WALLET_ENCRYPTION_KEY: z
    .string({ error: 'WALLET_ENCRYPTION_KEY is required' })
    .min(1, 'WALLET_ENCRYPTION_KEY is required')
    .transform((v, ctx) => {
      const key = decodeEncryptionKey(v);
      if (!key) {
        ctx.addIssue({
          code: 'custom',
          message: 'WALLET_ENCRYPTION_KEY must be 32 bytes encoded as base64 (44 chars) or hex (64 chars)',
        });
        return z.NEVER;
      }
      return key;
    }),
  DEMO_USER_ID: z.string().min(1).default('demo-user-001'),
  /** Apply pending migrations (and seed the demo user) on the first API request. */
  DB_AUTO_MIGRATE: z
    .enum(['true', 'false'], { error: 'DB_AUTO_MIGRATE must be "true" or "false"' })
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/** Validates an env source. Error messages name variables but never echo values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

/** Repository root (works from both src/ and dist/). */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

let cached: Env | undefined;

/** Loads `<repo>/.env` into process.env if present. Real env vars always win. */
function loadDotenv(): void {
  const envFile = path.join(repoRoot, '.env');
  if (existsSync(envFile)) dotenv.config({ path: envFile, quiet: true });
}

/** Loads `<repo>/.env` (if present) and validates process.env. */
export function loadEnv(): Env {
  if (cached) return cached;
  loadDotenv();
  cached = parseEnv(process.env);
  return cached;
}

const databaseEnvSchema = envSchema.pick({ DATABASE_URL: true, DEMO_USER_ID: true });
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

/**
 * Subset needed by database scripts (migrate, seed), so they can target a hosted
 * database with only DATABASE_URL set — no wallet encryption key required.
 */
export function loadDatabaseEnv(): DatabaseEnv {
  loadDotenv();
  const result = databaseEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
