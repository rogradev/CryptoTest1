// Creates .env from .env.example and fills in a freshly generated
// WALLET_ENCRYPTION_KEY. Never overwrites an existing .env.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

if (existsSync(envPath)) {
  console.log('.env already exists — leaving it untouched.');
  process.exit(0);
}

const template = readFileSync(path.join(root, '.env.example'), 'utf8');
const key = randomBytes(32).toString('base64');
writeFileSync(envPath, template.replace(/^WALLET_ENCRYPTION_KEY=.*$/m, `WALLET_ENCRYPTION_KEY=${key}`), {
  mode: 0o600,
});
console.log('Created .env with a new random WALLET_ENCRYPTION_KEY.');
