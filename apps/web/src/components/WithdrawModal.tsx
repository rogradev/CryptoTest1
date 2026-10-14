import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  isSolanaAddressFormat,
  lamportsToSol,
  solToLamports,
  type WithdrawalDto,
  type WithdrawalValidationDto,
} from '@wallet/shared';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Lock, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { formatSol } from '../lib/format';
import type { WalletState } from '../hooks/useWallet';
import { Button, Modal, Pill } from './ui';
import { StatusSteps, withdrawalSteps } from './StatusSteps';

const ACCESS_CODE_STORAGE_KEY = 'wallet-demo-access-code';
const FINAL: WithdrawalDto['status'][] = ['completed', 'failed', 'cancelled'];

function safeLamports(amount: string): bigint | null {
  try {
    return solToLamports(amount);
  } catch {
    return null;
  }
}

function readStoredCode(): string {
  try {
    return sessionStorage.getItem(ACCESS_CODE_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

const newIdempotencyKey = () => crypto.randomUUID();

export function WithdrawModal({ open, onClose, state }: { open: boolean; onClose: () => void; state: WalletState }) {
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [accessCode, setAccessCode] = useState(readStoredCode);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WithdrawalValidationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withdrawal, setWithdrawal] = useState<WithdrawalDto | null>(null);
  // One key per attempt: a double click or retry of the same attempt never sends twice.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const overview = state.overview.data;
  const policy = overview?.withdrawals;
  const fee = BigInt(policy?.estimatedFeeLamports ?? '5000');
  const maxPerWithdrawal = policy ? BigInt(policy.maxLamports) : null;
  const available = overview ? BigInt(overview.available.lamports) : null;
  const maxLamports = (() => {
    if (available === null) return 0n;
    const spendable = available > fee ? available - fee : 0n;
    return maxPerWithdrawal !== null && spendable > maxPerWithdrawal ? maxPerWithdrawal : spendable;
  })();

  const localIssues = useMemo(() => {
    const issues: { destination?: string; amount?: string } = {};
    if (destination && !isSolanaAddressFormat(destination.trim())) issues.destination = 'Not a valid Solana address';
    else if (destination && destination.trim() === overview?.address) issues.destination = 'This is your own wallet address';
    if (amount) {
      const lamports = safeLamports(amount);
      if (lamports === null) issues.amount = 'Up to 9 decimal places';
      else if (lamports === 0n) issues.amount = 'Must be greater than zero';
      else if (available !== null && lamports + fee > available) issues.amount = 'Exceeds available balance';
      else if (maxPerWithdrawal !== null && lamports > maxPerWithdrawal)
        issues.amount = `Demo limit ${formatSol(maxPerWithdrawal, 2)} SOL per withdrawal`;
    }
    return issues;
  }, [destination, amount, available, fee, maxPerWithdrawal, overview?.address]);

  const inputsValid = Boolean(destination && amount && !localIssues.destination && !localIssues.amount);
  const enabled = policy?.enabled ?? false;
  const needsCode = policy?.accessCodeRequired ?? false;
  const canWithdraw = enabled && inputsValid && (!needsCode || accessCode.trim().length > 0) && !submitting;

  // Track an in-flight withdrawal until it is final. Each poll asks the server
  // to sync, which settles the withdrawal from chain state.
  const { refresh } = state;
  const trackingId = withdrawal && !FINAL.includes(withdrawal.status) ? withdrawal.id : null;
  useEffect(() => {
    if (!trackingId) return;
    const timer = setInterval(async () => {
      try {
        await refresh();
        setWithdrawal(await api.withdrawal(trackingId));
      } catch {
        // transient: keep polling
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [trackingId, refresh]);

  const resetAttempt = () => {
    setResult(null);
    setError(null);
    setIdempotencyKey(newIdempotencyKey());
  };

  const check = async () => {
    if (!inputsValid) return;
    setChecking(true);
    setError(null);
    try {
      setResult(await api.validateWithdrawal({ destinationAddress: destination.trim(), amountSol: amount.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setChecking(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWithdraw) return;
    setSubmitting(true);
    setError(null);
    try {
      const code = accessCode.trim();
      const created = await api.withdraw(
        { destinationAddress: destination.trim(), amountSol: amount.trim() },
        idempotencyKey,
        needsCode ? code : undefined,
      );
      if (needsCode) {
        try {
          sessionStorage.setItem(ACCESS_CODE_STORAGE_KEY, code);
        } catch {
          // storage unavailable: the code just isn't remembered
        }
      }
      setWithdrawal(created);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdrawal failed');
    } finally {
      setSubmitting(false);
    }
  };

  const startOver = () => {
    setWithdrawal(null);
    setAmount('');
    resetAttempt();
  };

  const inputClass =
    'w-full rounded-2xl border bg-black/30 px-4 py-3.5 text-sm text-white placeholder:text-slate-600 outline-none transition focus:ring-2 focus:ring-sol-purple/50';

  return (
    <Modal open={open} onClose={onClose} title="Withdraw SOL" subtitle="Send SOL from your wallet to another Solana address">
      {withdrawal ? (
        <WithdrawalProgress withdrawal={withdrawal} onDone={startOver} />
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Destination Address</span>
            <input
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                resetAttempt();
              }}
              placeholder="Solana address"
              spellCheck={false}
              autoComplete="off"
              className={`${inputClass} mt-2 font-mono ${localIssues.destination ? 'border-rose-400/50' : 'border-white/10'}`}
            />
            {localIssues.destination && <span className="mt-1.5 block text-xs text-rose-300">{localIssues.destination}</span>}
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-400">Amount</span>
            <div className="relative mt-2">
              <input
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value.replace(',', '.'));
                  resetAttempt();
                }}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                className={`${inputClass} tabular pr-28 text-lg font-semibold ${localIssues.amount ? 'border-rose-400/50' : 'border-white/10'}`}
              />
              <div className="absolute inset-y-0 right-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAmount(lamportsToSol(maxLamports).replace(/\.?0+$/, '') || '0');
                    resetAttempt();
                  }}
                  className="rounded-lg bg-white/5 px-2 py-1 text-[11px] font-semibold text-violet-300 transition hover:bg-white/10"
                >
                  MAX
                </button>
                <span className="text-sm font-medium text-slate-400">SOL</span>
              </div>
            </div>
            <div className="mt-1.5 flex justify-between gap-3 text-xs">
              <span className="text-rose-300">{localIssues.amount}</span>
              <span className="shrink-0 text-slate-500">
                Available balance:{' '}
                <span className="tabular text-slate-300">{available !== null ? `${formatSol(available)} SOL` : '—'}</span>
              </span>
            </div>
            <div className="mt-1 text-right text-[11px] text-slate-600">
              Network fee ≈ {formatSol(fee, 6)} SOL
              {maxPerWithdrawal !== null && <> · demo limit {formatSol(maxPerWithdrawal, 2)} SOL</>}
            </div>
          </label>

          {enabled && needsCode && (
            <label className="block">
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <KeyRound className="size-3.5" /> Demo access code
              </span>
              <input
                type="password"
                value={accessCode}
                onChange={(e) => {
                  setAccessCode(e.target.value);
                  setError(null);
                }}
                placeholder="Required to execute withdrawals"
                autoComplete="off"
                className={`${inputClass} mt-2 border-white/10`}
              />
            </label>
          )}

          {result && (
            <div className="animate-fade-up rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 text-sm">
              <div className="mb-3 flex items-center gap-2 font-medium">
                {result.valid ? (
                  <>
                    <ShieldCheck className="size-4 text-sol-green" /> <span className="text-slate-100">Checks passed</span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-4 text-rose-300" /> <span className="text-slate-100">Cannot withdraw</span>
                  </>
                )}
              </div>
              {result.issues.length > 0 ? (
                <ul className="space-y-1 text-xs text-rose-200">
                  {result.issues.map((issue) => (
                    <li key={issue.field + issue.message}>• {issue.message}</li>
                  ))}
                </ul>
              ) : (
                <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
                  <dt className="text-slate-500">Amount</dt>
                  <dd className="tabular text-right text-slate-200">{formatSol(result.amountLamports ?? '0')} SOL</dd>
                  <dt className="text-slate-500">Est. network fee</dt>
                  <dd className="tabular text-right text-slate-200">{formatSol(result.estimatedFeeLamports, 6)} SOL</dd>
                  <dt className="text-slate-500">Address</dt>
                  <dd className="flex items-center justify-end gap-1 text-slate-200">
                    <CheckCircle2 className="size-3 text-sol-green" /> Valid Solana address
                  </dd>
                </dl>
              )}
            </div>
          )}
          {error && <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-200">{error}</div>}

          <div className="space-y-2.5">
            <Button variant="secondary" className="w-full" disabled={!inputsValid || checking} onClick={() => void check()}>
              {checking ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Check withdrawal
            </Button>
            {enabled ? (
              <Button type="submit" className="w-full" disabled={!canWithdraw}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                {submitting ? 'Reserving & signing…' : amount && inputsValid ? `Withdraw ${amount} SOL` : 'Withdraw'}
              </Button>
            ) : (
              <Button className="w-full" disabled title="Withdrawals are disabled in this environment">
                <Lock className="size-4" /> Withdrawals disabled in this environment
              </Button>
            )}
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-sol-purple/25 bg-sol-purple/[0.07] p-4">
            <Lock className="mt-0.5 size-4 shrink-0 text-violet-300" />
            <div className="text-xs leading-relaxed text-violet-100/80">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-semibold text-violet-200">Real Solana Devnet transaction</span>
                <Pill tone="purple">Devnet only</Pill>
              </div>
              Funds are reserved in the ledger before signing; if the network rejects or drops the transaction, they are
              released automatically.
              {!enabled && ' This environment has withdrawals switched off (WITHDRAWALS_ENABLED).'}
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

function WithdrawalProgress({ withdrawal, onDone }: { withdrawal: WithdrawalDto; onDone: () => void }) {
  const done = withdrawal.status === 'completed';
  const failed = withdrawal.status === 'failed' || withdrawal.status === 'cancelled';
  return (
    <div className="animate-fade-up space-y-5">
      <div className="text-center">
        <div
          className={`mx-auto flex size-14 items-center justify-center rounded-2xl ${
            done ? 'bg-sol-green/10' : failed ? 'bg-rose-400/10' : 'bg-violet-400/10'
          }`}
        >
          {done ? (
            <CheckCircle2 className="size-7 text-sol-green" />
          ) : failed ? (
            <XCircle className="size-7 text-rose-300" />
          ) : (
            <Loader2 className="size-7 animate-spin text-violet-300" />
          )}
        </div>
        <div className="tabular mt-3 text-2xl font-semibold text-white">−{formatSol(withdrawal.amountLamports)} SOL</div>
        <div className="mt-1 font-mono text-xs text-slate-500">to {withdrawal.destinationAddress}</div>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
        <StatusSteps steps={withdrawalSteps(withdrawal.status)} />
        <p className="mt-3 text-xs text-slate-400">
          {done
            ? `Completed and finalized on Solana Devnet. Network fee: ${formatSol(withdrawal.feeLamports ?? '0', 6)} SOL.`
            : failed
              ? withdrawal.failureReason
              : withdrawal.status === 'confirming'
                ? 'Included in a block — waiting for finalization…'
                : 'Signed and sent to Solana Devnet — waiting for confirmation…'}
        </p>
        {failed && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-sol-green">
            <Undo2 className="size-3.5" /> Reserved funds were released back to your available balance.
          </p>
        )}
      </div>

      {withdrawal.explorerUrl && (
        <a
          href={withdrawal.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-slate-300 transition hover:border-white/20 hover:text-white"
        >
          <span>
            <span className="block text-[11px] uppercase tracking-[0.12em] text-slate-500">Transaction signature</span>
            <span className="font-mono">{withdrawal.signature?.slice(0, 20)}…</span>
          </span>
          <span className="inline-flex items-center gap-1 font-medium">
            Solana Explorer <ExternalLink className="size-3.5" />
          </span>
        </a>
      )}

      {(done || failed) && (
        <Button variant="secondary" className="w-full" onClick={onDone}>
          New withdrawal
        </Button>
      )}
    </div>
  );
}
