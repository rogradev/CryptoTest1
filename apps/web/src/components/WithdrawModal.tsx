import { useMemo, useState, type FormEvent } from 'react';
import { isSolanaAddressFormat, lamportsToSol, solToLamports, type WithdrawalValidationDto } from '@wallet/shared';
import { CheckCircle2, Construction, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { formatSol } from '../lib/format';
import type { WalletState } from '../hooks/useWallet';
import { Button, Modal, Pill } from './ui';

const FEE_LAMPORTS = 5_000n;

function safeLamports(amount: string): bigint | null {
  try {
    return solToLamports(amount);
  } catch {
    return null;
  }
}

export function WithdrawModal({ open, onClose, state }: { open: boolean; onClose: () => void; state: WalletState }) {
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<WithdrawalValidationDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const available = state.balance.data ? BigInt(state.balance.data.balanceLamports) : null;
  const maxLamports = available !== null && available > FEE_LAMPORTS ? available - FEE_LAMPORTS : 0n;

  const localIssues = useMemo(() => {
    const issues: { destination?: string; amount?: string } = {};
    if (destination && !isSolanaAddressFormat(destination.trim())) issues.destination = 'Not a valid Solana address';
    if (amount) {
      const lamports = safeLamports(amount);
      if (lamports === null) issues.amount = 'Up to 9 decimal places';
      else if (lamports === 0n) issues.amount = 'Must be greater than zero';
      else if (available !== null && lamports + FEE_LAMPORTS > available) issues.amount = 'Exceeds available balance';
    }
    return issues;
  }, [destination, amount, available]);

  const canCheck = destination && amount && !localIssues.destination && !localIssues.amount;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canCheck) return;
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

  const reset = () => setResult(null);
  const inputClass =
    'w-full rounded-2xl border bg-black/30 px-4 py-3.5 text-sm text-white placeholder:text-slate-600 outline-none transition focus:ring-2 focus:ring-sol-purple/50';

  return (
    <Modal open={open} onClose={onClose} title="Withdraw SOL" subtitle="Send SOL from your wallet to another Solana address">
      <form onSubmit={onSubmit} className="space-y-5">
        <label className="block">
          <span className="text-xs font-medium text-slate-400">Destination Address</span>
          <input
            value={destination}
            onChange={(e) => {
              setDestination(e.target.value);
              reset();
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
                reset();
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
                  reset();
                }}
                className="rounded-lg bg-white/5 px-2 py-1 text-[11px] font-semibold text-violet-300 transition hover:bg-white/10"
              >
                MAX
              </button>
              <span className="text-sm font-medium text-slate-400">SOL</span>
            </div>
          </div>
          <div className="mt-1.5 flex justify-between text-xs">
            <span className="text-rose-300">{localIssues.amount}</span>
            <span className="text-slate-500">
              Available balance:{' '}
              <span className="tabular text-slate-300">{available !== null ? `${formatSol(available)} SOL` : '—'}</span>
            </span>
          </div>
        </label>

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
          <Button type="submit" variant="secondary" className="w-full" disabled={!canCheck || checking}>
            {checking ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Check withdrawal
          </Button>
          <Button className="w-full" disabled title="Withdrawal broadcasting is the next milestone">
            Withdraw · available next milestone
          </Button>
        </div>

        <div className="flex items-start gap-3 rounded-2xl border border-sol-purple/25 bg-sol-purple/[0.07] p-4">
          <Construction className="mt-0.5 size-4 shrink-0 text-violet-300" />
          <div className="text-xs leading-relaxed text-violet-100/80">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-semibold text-violet-200">Next development milestone</span>
              <Pill tone="purple">In progress</Pill>
            </div>
            Address and balance checks run against the live API and Devnet balance. Signing and broadcasting withdrawals is
            not enabled in this checkpoint — no funds are moved.
          </div>
        </div>
      </form>
    </Modal>
  );
}
