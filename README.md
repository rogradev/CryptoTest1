# Wallet Prototype — PERN + Solana Devnet

A runnable **development checkpoint** of a custodial SOL wallet:

```
React (Vite) ──► Express / TypeScript API ──► PostgreSQL
                          │
                          └──► Wallet service ──► Solana Devnet (live RPC)
```

The app generates a **real Solana Devnet wallet** on the server, stores its secret key
**encrypted (AES-256-GCM)** in PostgreSQL, and shows the wallet's **live on-chain balance**,
deposit address and QR code in a responsive dashboard. Nothing in the UI is mocked:
balances and transactions are read from Solana Devnet on every request.

> ⚠️ **Devnet only.** This is a prototype custody architecture for demonstration and
> development. It is **not production custody** and must never hold mainnet funds.

![Dashboard](docs/screenshots/01-dashboard.png)

---

## Checkpoint status

```
Current implemented checkpoint:

✓ PERN application
✓ PostgreSQL persistence
✓ demo-user abstraction
✓ real Solana Devnet wallet
✓ encrypted Devnet wallet secret
✓ wallet dashboard
✓ Add Funds interface
✓ real address
✓ QR code
✓ real on-chain Devnet balance
✓ balance refresh

Next milestone:

→ automatic deposit detection
→ internal ledger
→ deposit confirmation states
→ complete withdrawal broadcasting
→ unified transaction history
```

Also included in this checkpoint:

- Recent on-chain activity for the wallet (signatures + net SOL change, read live from Devnet).
- Withdraw screen with **real validation only** (address format, amount, available on-chain
  balance + fee). Signing/broadcasting is intentionally disabled and labelled as the next
  milestone; `POST /api/wallet/withdrawals` returns `501 NOT_IMPLEMENTED`.
- Full database schema for deposits, withdrawals, ledger entries and blockchain transactions.

---

## Quick start

Requirements: **Node.js ≥ 22.12**, npm ≥ 10, Docker (for PostgreSQL).

```bash
npm install
npm run setup:env        # creates .env with a random WALLET_ENCRYPTION_KEY
docker compose up -d     # PostgreSQL 16 on localhost:5432
npm run db:migrate
npm run db:seed          # creates demo-user-001
npm run dev              # API on :3001 + web on :5173
```

Open **http://localhost:5173**. The first request creates the demo user's Devnet wallet;
every later request (and every restart) returns the same wallet.

> Prefer to create `.env` by hand? `cp .env.example .env` and set `WALLET_ENCRYPTION_KEY`
> (see [Environment variables](#environment-variables)).

### Useful scripts (root)

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts API (tsx watch) and web (Vite) together |
| `npm run build` | Production build of shared, API (`apps/api/dist`) and web (`apps/web/dist`) |
| `npm start` | Runs the compiled API (`node apps/api/dist/server.js`) |
| `npm run db:migrate` | Applies pending SQL migrations from `database/migrations` |
| `npm run db:seed` | Seeds `demo-user-001` (idempotent) |
| `npm test` | Unit + HTTP tests (no network / Devnet required) |
| `npm run typecheck` | `tsc --noEmit` for all workspaces (strict mode) |
| `npm run lint` | ESLint (TypeScript + React hooks rules) |

---

## Architecture

```
apps/web  (React)                     apps/api  (Express)
┌─────────────────────┐   /api/*     ┌───────────────────────────────────────────────┐
│ Dashboard           │ ───────────► │ helmet · cors · json · request log            │
│ Add Funds (QR)      │  Vite proxy  │ authenticate  ◄── DemoUserMiddleware (swap)   │
│ Withdraw (validate) │              │ walletRoutes  (Zod validation, JSON envelope) │
│ Transactions        │              │        │                                      │
└─────────────────────┘              │        ▼                                      │
                                     │ WalletService / WithdrawalService  (userId)   │
                                     │   │                │               │          │
                                     │   ▼                ▼               ▼          │
                                     │ Repositories   SecretCipher   BlockchainProvider
                                     │ (pg, SQL)      (AES-256-GCM)  └ SolanaDevnetProvider
                                     └───┼────────────────────────────────┼──────────┘
                                         ▼                                ▼
                                    PostgreSQL                     Solana Devnet RPC
```

Key design decisions:

- **Identity is a plain `userId: string`.** Services never look at tokens, sessions or the
  demo user. `DemoUserMiddleware` (`apps/api/src/middleware/demoUser.ts`) sets
  `req.user = { id, authMode }`; controllers read it via `requireUserId(req)`. To integrate
  with the client's backend, swap it for their JWT/session middleware in
  `createHttpApp()` (`apps/api/src/container.ts`) — nothing else changes. `users.id` is `TEXT` so any identifier format fits.
- **Blockchain behind an interface.** `BlockchainProvider` (`apps/api/src/blockchain/types.ts`)
  is the only boundary to the chain; `@solana/web3.js` is imported in exactly one file,
  `SolanaDevnetProvider`. `sendTransaction()`, `getTransaction()` and `detectDeposits()`
  slot into this interface in the next milestone without touching controllers or the UI.
- **Two runtimes, one app.** `src/server.ts` runs a long-lived server (`npm run dev`,
  `npm start`); `src/app.ts` default-exports the same app for Vercel Functions.
- **Composition root.** `apps/api/src/container.ts` wires repositories, cipher, provider and
  services, and `createHttpApp()` picks the authentication middleware. `createApp()`
  (`createApp.ts`) receives dependencies, which is what makes the HTTP tests run against
  in-memory fakes.
- **Money is integer lamports.** `BIGINT` in SQL, `bigint` in TypeScript, strings over JSON.
  `packages/shared/src/lamports.ts` converts SOL ↔ lamports with exact string arithmetic;
  conversion to SOL happens only for display.
- **On-chain balance ≠ ledger balance.** `WalletService.getOnChainBalance(userId)` and the
  `source: "on-chain"` field make explicit that the shown balance is the live chain balance.
  The internal ledger balance (sum of `ledger_entries`) arrives with the next milestone.

### Folder structure

```
.
├── apps/
│   ├── api/                       Express + TypeScript API
│   │   ├── src/
│   │   │   ├── blockchain/        BlockchainProvider interface + SolanaDevnetProvider
│   │   │   ├── config/env.ts      Zod-validated environment (devnet guard)
│   │   │   ├── db/                pg pool, migration runner, seed
│   │   │   ├── http/              routes (controllers) + response helper
│   │   │   ├── lib/               SecretCipher (AES-256-GCM), errors, logger
│   │   │   ├── middleware/        auth contract, DemoUserMiddleware, error handler
│   │   │   ├── repositories/      parameterized SQL access (users, wallet_accounts)
│   │   │   ├── services/          WalletService, WithdrawalService
│   │   │   ├── app.ts             Vercel Function entrypoint (default-exports the app)
│   │   │   ├── createApp.ts       Express app factory
│   │   │   ├── container.ts       composition root
│   │   │   └── server.ts          long-running server entry point (local / npm start)
│   │   └── test/                  Vitest unit, HTTP and PostgreSQL integration tests
│   └── web/                       React + Vite + Tailwind CSS
│       └── src/
│           ├── components/        BalanceCard, AddFundsModal, WithdrawModal, …
│           ├── hooks/             useAsync, useWallet
│           └── lib/               API client, formatting, clipboard
├── packages/
│   └── shared/                    API types (DTOs), lamports math, address format check
├── database/
│   └── migrations/                plain SQL migrations (001_initial_schema.sql)
├── docs/screenshots/              screenshots of the running checkpoint
├── scripts/init-env.mjs           creates .env with a random encryption key
├── docker-compose.yml             PostgreSQL 16
├── vercel.json                    Vercel multi-service deployment (api + web)
├── .env.example
├── eslint.config.js
├── package.json                   npm workspaces
└── tsconfig.json                  shared strict compiler options
```

---

## PostgreSQL & migrations

`docker compose up -d` starts PostgreSQL 16 with user/password `wallet`/`wallet` and database
`wallet_prototype` (data in the `wallet_pgdata` volume). Any PostgreSQL ≥ 13 works — just point
`DATABASE_URL` at it.

`npm run db:migrate` applies every `database/migrations/*.sql` file in order, each in its own
transaction, recording them in `schema_migrations`. Migrations are forward-only; add new files
such as `002_….sql`.

**Automatic migrations (`DB_AUTO_MIGRATE=true`, the default).** On the first API request each
server/function instance applies pending migrations and ensures the demo user exists, so a
fresh database (such as a new Vercel deployment's) needs no manual step. Every step runs in a
transaction holding a transaction-scoped advisory lock, so simultaneous cold starts are safe,
including behind transaction-mode poolers (Neon, PgBouncer).

The SQL files are embedded into `apps/api/src/db/migrations.generated.ts` (serverless bundles
cannot read repository files at runtime). After adding or editing a migration run
`npm run db:embed -w @wallet/api` (`db:migrate` does it automatically); a test fails if the
generated file is out of sync.

### Schema

| Table | Purpose | Status |
| --- | --- | --- |
| `users` | Local identity (`id TEXT`, `display_name`, `created_at`) | **in use** (demo user) |
| `wallet_accounts` | One wallet per user per network: `address`, `encrypted_secret`, `network`, `created_at`. `UNIQUE (user_id, network)` | **in use** |
| `blockchain_transactions` | Normalized on-chain transactions per wallet: `signature`, `direction`, signed `amount_lamports`, `fee_lamports`, `slot`, `block_time`, `status` | schema ready |
| `deposits` | Deposit lifecycle `detected → confirmed → credited / failed`, unique `signature` | schema ready |
| `withdrawals` | Withdrawal lifecycle `pending → processing → broadcast → completed / failed / cancelled`, `idempotency_key`, `fee_lamports`, `failure_reason` | schema ready |
| `ledger_entries` | Append-only signed ledger (`deposit`, `withdrawal`, `withdrawal_fee`, `adjustment`) referencing deposits/withdrawals; balance = `SUM(amount_lamports)` | schema ready |

All amounts are `BIGINT` lamports with `CHECK` constraints (positive amounts, non-zero ledger
entries, allowed status values). Foreign keys use `ON DELETE RESTRICT` — financial history is
never cascaded away.

---

## Environment variables

Validated with Zod at startup; the API refuses to start with a clear message listing every
invalid variable (values are never echoed).

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `DATABASE_URL` | — (required) | `postgresql://wallet:wallet@localhost:5432/wallet_prototype` with docker-compose |
| `PORT` | `3001` | API port |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Any Devnet RPC (e.g. a Helius/QuickNode devnet URL). URLs containing `mainnet` are rejected |
| `SOLANA_CLUSTER` | `devnet` | Must be `devnet`; anything else is rejected |
| `WALLET_ENCRYPTION_KEY` | — (required) | 32 random bytes, base64 (44 chars) or hex (64 chars) |
| `DEMO_USER_ID` | `demo-user-001` | Identity injected by `DemoUserMiddleware` |
| `DB_AUTO_MIGRATE` | `true` | Apply pending migrations and seed the demo user on the first API request |

Generate a key manually:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> **Keep the key stable.** Changing or losing `WALLET_ENCRYPTION_KEY` makes stored wallet
> secrets undecryptable (the public address and balance still display, but the wallet could
> no longer sign withdrawals).

---

## Solana Devnet configuration

- The API talks to `SOLANA_RPC_URL` (default public Devnet endpoint).
- **Mainnet protection, three layers:** `SOLANA_CLUSTER` must be `devnet`; mainnet-looking RPC
  URLs are rejected; and at runtime `SolanaDevnetProvider` verifies the RPC's **genesis hash**
  equals Devnet's (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`) before creating wallets or
  reading balances. Pointing the app at any other cluster makes it refuse to start.
- The public endpoint is rate limited. If you see `BLOCKCHAIN_UNAVAILABLE` errors during a demo,
  use a free dedicated Devnet RPC URL.
- `GET /api/health` reports database status, Devnet reachability, current slot and node version.

---

## How wallet creation works

1. A request reaches the API; `DemoUserMiddleware` sets `req.user.id = "demo-user-001"`.
2. `WalletService.getOrCreateWallet(userId)` looks up `wallet_accounts` for `(userId, solana-devnet)`.
   If a row exists it is returned — **a wallet is never regenerated**.
3. Otherwise `SolanaDevnetProvider.createWallet()` generates an Ed25519 keypair server-side.
4. The 64-byte secret key is encrypted with AES-256-GCM (random 96-bit IV, 128-bit tag, wallet
   address bound as additional authenticated data), self-checked by decrypting once, and the
   in-memory key buffer is zeroed.
5. The row is inserted with `ON CONFLICT (user_id, network) DO NOTHING`, so concurrent first
   requests still end up with exactly one wallet.

Stored envelope format: `v1.<iv>.<authTag>.<ciphertext>` (base64 parts). The secret is
never selected by read paths (repositories expose a public `WalletAccount` type without it),
never returned by the API and never logged.

---

## Funding the wallet & verifying balance changes

1. Open the app → **Add Funds**. Copy the address (or scan the QR).
2. Get Devnet SOL from <https://faucet.solana.com> (paste the address, choose Devnet), or with
   the Solana CLI:
   ```bash
   solana airdrop 1 <ADDRESS> --url devnet
   # or, from another devnet wallet:
   solana transfer <ADDRESS> 0.5 --url devnet --allow-unfunded-recipient
   ```
   The faucet is rate-limited per IP/account; if it refuses, wait or use another devnet source.
3. Click **Refresh Balance**. The API reads the balance from Devnet (`confirmed` commitment)
   and the UI shows the new amount with a `+X SOL` indicator; the deposit appears in
   **Recent Transactions** with a link to Solana Explorer.
4. Cross-check independently:
   ```bash
   curl -s localhost:3001/api/wallet/balance
   solana balance <ADDRESS> --url devnet
   # or https://explorer.solana.com/address/<ADDRESS>?cluster=devnet
   ```

---

## API

All responses use one envelope: `{ "ok": true, "data": … }` or
`{ "ok": false, "error": { "code", "message", "details?" } }`. Errors are centralized; stack
traces and internals are never returned.

| Method & path | Description |
| --- | --- |
| `GET /api/health` | DB + Devnet status, slot, node version (503 when degraded) |
| `GET /api/me` | Current user (`authMode: "demo"` in this checkpoint) |
| `GET /api/wallet` | Wallet (created on first call): id, network, address, explorer URL |
| `GET /api/wallet/balance` | **Live on-chain** balance: `balanceLamports` (string), `balanceSol` |
| `GET /api/wallet/deposit-address` | Address, `solana:` payment URI, explorer URL, devnet warning |
| `GET /api/wallet/transactions?limit=1..25` | Recent on-chain transactions with direction & net amount |
| `POST /api/wallet/withdrawals/validate` | Validates `{ destinationAddress, amountSol }` — no funds move |
| `POST /api/wallet/withdrawals` | `501 NOT_IMPLEMENTED` — placeholder for the next milestone |

Example:

```json
GET /api/wallet/balance
{
  "ok": true,
  "data": {
    "network": "solana-devnet",
    "address": "DbCu4LMZcYXihbnPfJ8z1nqzWgyegeiERzNZFfeyp3SV",
    "source": "on-chain",
    "balanceLamports": "1000000000",
    "balanceSol": "1.000000000",
    "fetchedAt": "2026-10-13T00:51:50.103Z"
  }
}
```

---

## Tests

```bash
npm test             # 58 tests: shared (lamports, address) + API (env, cipher, services, HTTP)
npm run typecheck
npm run lint
```

Unit and HTTP tests mock Solana (`MockBlockchainProvider`) and storage, so they never depend
on Devnet. Coverage includes SOL ↔ lamports conversion, address validation, environment
validation (including the mainnet guard), AES-GCM encryption/tamper detection, wallet
creation/persistence/idempotency/concurrency, withdrawal validation, and that no secret
material appears in any API response.

An extra integration test runs against a real, migrated PostgreSQL when `TEST_DATABASE_URL`
is set:

```bash
TEST_DATABASE_URL=postgresql://wallet:wallet@localhost:5432/wallet_prototype npm test -w @wallet/api
```

---

## Deploying to Vercel (services)

`vercel.json` deploys the repo as **one Vercel project with two services** on one domain:

| Service | Root | Framework | Public path | Notes |
| --- | --- | --- | --- | --- |
| `api` | `apps/api` | Express | `/api/*` | Vercel Function from `src/app.ts` (default export). Receives the original path, e.g. `/api/wallet` |
| `web` | `apps/web` | Vite | `/*` (catch-all) | Static build of `dist/` |

Rewrites are ordered most-specific first: `/api/(.*)` → `api`, then `/(.*)` → `web`.
The browser calls the API with same-origin relative URLs (`/api/...`), so no CORS
configuration or service binding is needed: there are no server-side calls between
services. Each service's `buildCommand` first builds `@wallet/shared`, which both import.

Before the first deploy:

1. Provision a hosted PostgreSQL (e.g. Neon via the Vercel Marketplace, which sets
   `DATABASE_URL`). The schema and demo user are created automatically on the first API
   request (`DB_AUTO_MIGRATE`). To do it by hand instead:
   `DATABASE_URL=<hosted-url> npm run db:migrate && DATABASE_URL=<hosted-url> npm run db:seed`.
2. Set project environment variables: `DATABASE_URL`, `WALLET_ENCRYPTION_KEY` (a new key,
   never the local one), and optionally `SOLANA_RPC_URL` (a dedicated Devnet RPC is
   recommended), `DEMO_USER_ID`. `CORS_ORIGIN` is not needed for the same-origin setup.
3. Deploy (`vercel deploy` or connect the Git repository).

Test the deployment topology locally with `vercel dev` (or `vercel dev -L` without
linking). It runs both services behind the same rewrites as production and reads `.env`.

> The demo user middleware means **anyone who can open the deployment controls the demo
> wallet** (validation only — nothing can be sent in this checkpoint). Keep the deployment
> behind Vercel Deployment Protection until real authentication is integrated.

---

## Security notes & limitations

Implemented even though this is Devnet:

- Private keys are generated server-side, encrypted with AES-256-GCM, never sent to the
  browser, never logged, never committed (`.env` is git-ignored).
- Solana addresses validated server-side with `PublicKey`; inputs validated with Zod.
- Parameterized SQL only; Helmet security headers; CORS restricted to configured origins;
  `Cache-Control: no-store` on API responses; 16 kB JSON body limit; TypeScript strict mode.

**Limitations — this is not production custody:**

- A single master key from an environment variable. Production needs a KMS/HSM, envelope
  encryption with per-wallet data keys, key rotation and access auditing.
- Hot wallet keys are decryptable by the API process. Production custody needs signing
  isolation (separate signer service/HSM/MPC), withdrawal limits, approvals and monitoring.
- No real authentication: `DemoUserMiddleware` trusts every request as `demo-user-001`. Do not
  expose this prototype publicly.
- No rate limiting on the API; the public Devnet RPC is itself rate limited.
- `package.json` `overrides` pins `uuid` to `^11.1.1` for `@solana/web3.js`'s dependencies.
  `rpc-websockets` otherwise pulls ESM-only `uuid@14` and `require()`s it, which crashes on
  runtimes without `require(esm)` (seen on Vercel as `ERR_REQUIRE_ESM`); 11.1.1 ships a
  CommonJS build and also fixes the `uuid` advisory.
- `npm audit` still reports moderate advisories in `stream-json` (via `jayson`, the RPC
  client). They affect parsing of RPC responses from the configured endpoint and are
  acceptable for a Devnet prototype; revisit (e.g. `@solana/kit`) before production.

---

## Next milestone

- **Automatic deposit detection** — `BlockchainProvider.detectDeposits()` + a poller/websocket
  worker writing `blockchain_transactions` and `deposits`.
- **Internal ledger** — append-only `ledger_entries`; internal balance next to on-chain balance.
- **Deposit confirmation states** — `detected → confirmed → credited` driven by commitment level.
- **Complete withdrawal broadcasting** — `WithdrawalService.requestWithdrawal()` with idempotency,
  ledger debit, signing via `SecretCipher`, `BlockchainProvider.sendTransaction()` and status
  tracking (the UI and `/withdrawals` endpoint are already in place).
- **Unified transaction history** — served from the database (deposits + withdrawals) instead
  of raw chain reads.
- **Client integration** — replace `DemoUserMiddleware` with the client's JWT/session middleware.
