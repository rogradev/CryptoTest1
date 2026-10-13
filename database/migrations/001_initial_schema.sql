-- 001_initial_schema.sql
-- Wallet prototype foundation schema.
--
-- Conventions
--   * All monetary values are integer lamports stored as BIGINT
--     (1 SOL = 1,000,000,000 lamports). No floating point anywhere.
--   * user_id is TEXT so the wallet module can adopt whatever identifier
--     the client's main backend uses (UUID, numeric id, external auth id).
--   * Tables for deposits, withdrawals, ledger and blockchain transactions
--     are defined now; their write paths ship in the next milestone.

-- ---------------------------------------------------------------------
-- users
-- Temporary local identity table. When integrated into the client's
-- backend, wallet tables can reference the client's own users table.
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    display_name  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- wallet_accounts
-- One custodial wallet per user per network. Secret key material is
-- stored ONLY in encrypted form (AES-256-GCM envelope, see API code).
-- ---------------------------------------------------------------------
CREATE TABLE wallet_accounts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    network            TEXT NOT NULL CHECK (network IN ('solana-devnet')),
    address            TEXT NOT NULL UNIQUE,
    encrypted_secret   TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wallet_accounts_user_network_unique UNIQUE (user_id, network)
);

-- ---------------------------------------------------------------------
-- blockchain_transactions
-- Raw, normalized on-chain transactions observed for a wallet account.
-- Populated by the deposit detector / withdrawal broadcaster (next milestone).
-- ---------------------------------------------------------------------
CREATE TABLE blockchain_transactions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_account_id  UUID NOT NULL REFERENCES wallet_accounts (id) ON DELETE RESTRICT,
    signature          TEXT NOT NULL,
    direction          TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'self', 'unknown')),
    amount_lamports    BIGINT NOT NULL,
    fee_lamports       BIGINT CHECK (fee_lamports >= 0),
    slot               BIGINT NOT NULL CHECK (slot >= 0),
    block_time         TIMESTAMPTZ,
    status             TEXT NOT NULL CHECK (status IN ('processed', 'confirmed', 'finalized', 'failed')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT blockchain_transactions_wallet_signature_unique UNIQUE (wallet_account_id, signature)
);
CREATE INDEX blockchain_transactions_wallet_slot_idx
    ON blockchain_transactions (wallet_account_id, slot DESC);

-- ---------------------------------------------------------------------
-- deposits
-- Business-level deposit lifecycle: detected -> confirmed -> credited.
-- ---------------------------------------------------------------------
CREATE TABLE deposits (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    wallet_account_id  UUID NOT NULL REFERENCES wallet_accounts (id) ON DELETE RESTRICT,
    signature          TEXT NOT NULL UNIQUE,
    amount_lamports    BIGINT NOT NULL CHECK (amount_lamports > 0),
    status             TEXT NOT NULL DEFAULT 'detected'
                       CHECK (status IN ('detected', 'confirmed', 'credited', 'failed')),
    detected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deposits_user_created_idx ON deposits (user_id, created_at DESC);
CREATE INDEX deposits_status_idx ON deposits (status) WHERE status IN ('detected', 'confirmed');

-- ---------------------------------------------------------------------
-- withdrawals
-- Withdrawal requests and their broadcast lifecycle.
-- idempotency_key protects against duplicate submissions.
-- ---------------------------------------------------------------------
CREATE TABLE withdrawals (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    wallet_account_id    UUID NOT NULL REFERENCES wallet_accounts (id) ON DELETE RESTRICT,
    destination_address  TEXT NOT NULL,
    amount_lamports      BIGINT NOT NULL CHECK (amount_lamports > 0),
    fee_lamports         BIGINT CHECK (fee_lamports >= 0),
    signature            TEXT UNIQUE,
    status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'processing', 'broadcast', 'completed', 'failed', 'cancelled')),
    failure_reason       TEXT,
    idempotency_key      TEXT UNIQUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at         TIMESTAMPTZ
);
CREATE INDEX withdrawals_user_created_idx ON withdrawals (user_id, created_at DESC);
CREATE INDEX withdrawals_status_idx ON withdrawals (status) WHERE status IN ('pending', 'processing', 'broadcast');

-- ---------------------------------------------------------------------
-- ledger_entries
-- Append-only internal ledger. Signed amounts: credits > 0, debits < 0.
-- A user's internal balance = SUM(amount_lamports). Rows are never
-- updated or deleted; corrections are new 'adjustment' entries.
-- ---------------------------------------------------------------------
CREATE TABLE ledger_entries (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    type             TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'withdrawal_fee', 'adjustment')),
    amount_lamports  BIGINT NOT NULL CHECK (amount_lamports <> 0),
    reference_type   TEXT CHECK (reference_type IN ('deposit', 'withdrawal', 'manual')),
    reference_id     UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ledger_entries_reference_unique UNIQUE (reference_type, reference_id, type)
);
CREATE INDEX ledger_entries_user_created_idx ON ledger_entries (user_id, created_at DESC);
