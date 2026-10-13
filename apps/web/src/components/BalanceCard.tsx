import { shortenAddress } from '@wallet/shared';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ExternalLink, RefreshCw } from 'lucide-react';
import { formatSol } from '../lib/format';
import type { WalletState } from '../hooks/useWallet';
import { Button } from './ui';

export function BalanceCard({
  state,
  onAddFunds,
  onWithdraw,
}: {
  state: WalletState;
  onAddFunds: () => void;
  onWithdraw: () => void;
}) {
  const { wallet, balance, refreshBalance, lastChange } = state;
  const refreshing = balance.refreshing || balance.loading;

  return (
    <section className="card relative overflow-hidden p-6 sm:p-8">
      {/* ambient glow */}
      <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-sol-purple/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 size-72 rounded-full bg-sol-green/10 blur-3xl" />

      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-slate-400">Available Balance</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">Live on-chain · Solana Devnet</div>
          </div>
          <button
            type="button"
            onClick={() => void refreshBalance()}
            disabled={refreshing || !wallet.data}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>

        <div className="mt-6 min-h-[88px]">
          {balance.data ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="tabular text-5xl font-semibold tracking-tight text-white sm:text-6xl">
                  {formatSol(balance.data.balanceLamports)}
                </span>
                <span className="text-xl font-medium text-slate-400">SOL</span>
                {lastChange !== null && (
                  <span
                    className={`animate-fade-up rounded-full px-2.5 py-1 text-xs font-semibold ${
                      lastChange > 0n ? 'bg-sol-green/15 text-sol-green' : 'bg-rose-400/15 text-rose-300'
                    }`}
                  >
                    {lastChange > 0n ? '+' : ''}
                    {formatSol(lastChange, 2)} SOL
                  </span>
                )}
              </div>
              <div className="tabular mt-2 font-mono text-xs text-slate-500">
                {BigInt(balance.data.balanceLamports).toLocaleString('en-US')} lamports · updated{' '}
                {new Date(balance.data.fetchedAt).toLocaleTimeString()}
              </div>
            </>
          ) : balance.error || wallet.error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <div className="font-medium">Balance unavailable</div>
                <div className="mt-0.5 text-rose-200/70">{balance.error ?? wallet.error}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="skeleton h-14 w-64" />
              <div className="skeleton h-3 w-48" />
            </div>
          )}
        </div>

        {wallet.data && (
          <a
            href={wallet.data.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 font-mono text-xs text-slate-300 transition hover:border-white/20 hover:text-white"
            title={wallet.data.address}
          >
            {shortenAddress(wallet.data.address, 6)}
            <ExternalLink className="size-3" />
          </a>
        )}

        <div className="mt-7 grid grid-cols-2 gap-3">
          <Button onClick={onAddFunds} disabled={!wallet.data}>
            <ArrowDownToLine className="size-4" /> Add Funds
          </Button>
          <Button variant="secondary" onClick={onWithdraw} disabled={!wallet.data}>
            <ArrowUpFromLine className="size-4" /> Withdraw
          </Button>
        </div>
      </div>
    </section>
  );
}
