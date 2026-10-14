-- 002_deposits_ledger_withdrawals.sql
-- Activates deposit detection, the internal ledger and real withdrawals.
-- Additive only: no existing data is rewritten.

-- ---------------------------------------------------------------------
-- wallet_accounts: deposit sync bookkeeping
-- ---------------------------------------------------------------------
ALTER TABLE wallet_accounts ADD COLUMN last_synced_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------
-- deposits: detected -> confirming -> confirmed (ledger credited) | failed
-- 'confirmed' means finalized on-chain AND credited to the ledger, in the
-- same database transaction. ('credited' was never used and is replaced.)
-- ---------------------------------------------------------------------
ALTER TABLE deposits DROP CONSTRAINT deposits_status_check;
ALTER TABLE deposits ADD CONSTRAINT deposits_status_check
    CHECK (status IN ('detected', 'confirming', 'confirmed', 'failed'));
ALTER TABLE deposits
    ADD COLUMN slot BIGINT CHECK (slot >= 0),
    ADD COLUMN block_time TIMESTAMPTZ,
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX deposits_wallet_status_idx ON deposits (wallet_account_id, status);

-- ---------------------------------------------------------------------
-- withdrawals: pending (funds reserved) -> processing (signed, signature
-- stored before sending) -> broadcast -> confirming -> completed | failed
-- ---------------------------------------------------------------------
ALTER TABLE withdrawals DROP CONSTRAINT withdrawals_status_check;
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_status_check
    CHECK (status IN ('pending', 'processing', 'broadcast', 'confirming', 'completed', 'failed', 'cancelled'));
ALTER TABLE withdrawals
    ADD COLUMN reserved_lamports BIGINT CHECK (reserved_lamports > 0),
    ADD COLUMN last_valid_block_height BIGINT,
    ADD COLUMN broadcast_at TIMESTAMPTZ,
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE withdrawals DROP CONSTRAINT withdrawals_idempotency_key_key;
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_user_idempotency_unique UNIQUE (user_id, idempotency_key);
CREATE INDEX withdrawals_wallet_status_idx ON withdrawals (wallet_account_id, status);

-- ---------------------------------------------------------------------
-- ledger_entries: reservation-based withdrawal accounting
--   reserve  : withdrawal_reserve  -(amount + fee)   when requested
--   complete : withdrawal_release  +(amount + fee)
--              withdrawal          -amount
--              withdrawal_fee      -actual fee        (one DB transaction)
--   fail     : withdrawal_release  +(amount + fee)
-- Available balance = SUM(amount_lamports). The existing UNIQUE
-- (reference_type, reference_id, type) makes every step happen at most once.
-- ---------------------------------------------------------------------
ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_type_check
    CHECK (type IN ('deposit', 'withdrawal', 'withdrawal_fee', 'withdrawal_reserve', 'withdrawal_release', 'adjustment'));

-- Ledger entries are immutable: corrections are new entries, never edits.
CREATE FUNCTION ledger_entries_reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entries is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_immutable
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION ledger_entries_reject_mutation();
