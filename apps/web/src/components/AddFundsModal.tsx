import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, Check, Copy, Droplets, ExternalLink, RefreshCw } from 'lucide-react';
import { depositSteps, StatusSteps } from './StatusSteps';
import { api } from '../lib/api';
import { copyToClipboard, formatSol } from '../lib/format';
import { useAsync } from '../hooks/useAsync';
import type { WalletState } from '../hooks/useWallet';
import { Button, Field, Modal } from './ui';

/** Deposits credited after this moment are highlighted as "just confirmed". */
const PAGE_LOADED_AT = Date.now();

export function AddFundsModal({ open, onClose, state }: { open: boolean; onClose: () => void; state: WalletState }) {
  const deposit = useAsync(async () => (open ? api.depositAddress() : null), [open]);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const { overview, activity, refresh, lastChange } = state;
  const refreshing = overview.refreshing || overview.loading;
  // Most recent deposit: shown while in progress, or once it was credited during this visit.
  const latestDeposit = activity.data?.items.find((item) => item.kind === 'deposit');
  const showDeposit =
    latestDeposit &&
    (latestDeposit.status !== 'confirmed' ||
      new Date(latestDeposit.settledAt ?? latestDeposit.createdAt).getTime() >= PAGE_LOADED_AT);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2200);
    return () => clearTimeout(t);
  }, [copied]);

  const address = deposit.data?.address;

  return (
    <Modal open={open} onClose={onClose} title="Add Funds" subtitle="Receive SOL to your wallet address">
      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <Field label="Asset">
          <span className="inline-flex items-center gap-2">
            <span className="size-4 rounded-full bg-gradient-to-br from-sol-purple to-sol-green" /> SOL
          </span>
        </Field>
        <Field label="Network">Solana Devnet</Field>
      </div>

      <div className="mt-5 flex flex-col items-center">
        {address ? (
          <>
            <div className="rounded-3xl bg-white p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_20px_50px_-20px_rgba(153,69,255,0.6)]">
              <QRCodeSVG value={address} size={196} level="M" marginSize={0} title={`Solana address ${address}`} />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">Scan to get the deposit address</div>
            <div className="mt-4 w-full rounded-2xl border border-white/[0.08] bg-black/30 px-4 py-3 text-center">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Your SOL address</div>
              <div className="mt-1.5 break-all font-mono text-[13px] leading-relaxed text-slate-100" data-testid="deposit-address">
                {address}
              </div>
            </div>
            <div className="mt-3 grid w-full grid-cols-[1fr_auto] gap-2">
              <Button
                variant={copied === 'ok' ? 'secondary' : 'primary'}
                onClick={async () => setCopied((await copyToClipboard(address)) ? 'ok' : 'fail')}
              >
                {copied === 'ok' ? (
                  <>
                    <Check className="size-4 text-sol-green" /> Address copied
                  </>
                ) : copied === 'fail' ? (
                  'Copy failed — select manually'
                ) : (
                  <>
                    <Copy className="size-4" /> Copy Address
                  </>
                )}
              </Button>
              <a
                href={deposit.data?.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-2xl px-4 text-slate-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/5 hover:text-white"
                title="View on Solana Explorer"
              >
                <ExternalLink className="size-4" />
              </a>
            </div>
          </>
        ) : deposit.error ? (
          <div className="w-full rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200">{deposit.error}</div>
        ) : (
          <>
            <div className="skeleton size-[228px] rounded-3xl" />
            <div className="skeleton mt-4 h-14 w-full rounded-2xl" />
          </>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Available balance</div>
          <div className="tabular mt-1 flex items-center gap-2 text-lg font-semibold text-white">
            {overview.data ? `${formatSol(overview.data.available.lamports)} SOL` : '—'}
            {lastChange !== null && lastChange > 0n && (
              <span className="animate-fade-up rounded-full bg-sol-green/15 px-2 py-0.5 text-xs font-semibold text-sol-green">
                +{formatSol(lastChange, 2)} credited
              </span>
            )}
          </div>
          {overview.data?.onChain && (
            <div className="tabular mt-0.5 text-[11px] text-slate-500">On-chain: {formatSol(overview.data.onChain.lamports)} SOL</div>
          )}
        </div>
        <Button variant="secondary" className="shrink-0 px-4" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh Balance</span>
          <span className="sm:hidden">Refresh</span>
        </Button>
      </div>

      {showDeposit ? (
        <a
          href={latestDeposit.explorerUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="animate-fade-up mt-3 block rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 transition hover:border-white/15"
        >
          <div className="mb-3 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">
              Deposit +{formatSol(latestDeposit.amountLamports, 2)} SOL
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-slate-500">
              {latestDeposit.signature?.slice(0, 8)}… <ExternalLink className="size-3" />
            </span>
          </div>
          <StatusSteps steps={depositSteps(latestDeposit.status)} />
        </a>
      ) : (
        <p className="mt-3 text-center text-[11px] text-slate-500">
          Incoming deposits are detected automatically — keep this window open to watch them confirm.
        </p>
      )}

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-4">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
        <div className="text-xs leading-relaxed text-amber-100/80">
          <div className="font-semibold uppercase tracking-[0.12em] text-amber-300">Devnet test funds only</div>
          Send only Solana Devnet SOL. Devnet tokens have no monetary value. Never send mainnet funds to this address.
        </div>
      </div>

      <a
        href="https://faucet.solana.com/"
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center justify-center gap-2 py-2 text-xs text-slate-400 transition hover:text-white"
      >
        <Droplets className="size-3.5" /> Get free Devnet SOL from the Solana faucet
      </a>
    </Modal>
  );
}
