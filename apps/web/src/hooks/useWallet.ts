import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAsync } from './useAsync';

const SLOW_POLL_MS = 15_000;
const FAST_POLL_MS = 3_000;

/**
 * Wallet state for the dashboard. The wallet must exist before the overview
 * and activity are fetched (the first call creates it server-side).
 *
 * The overview is polled: each poll lets the API check Devnet for new
 * deposits and settle in-flight withdrawals. Polling is fast while something
 * is pending or a modal is open, slow otherwise.
 */
export function useWallet({ fastPolling = false }: { fastPolling?: boolean } = {}) {
  const user = useAsync(api.me);
  const wallet = useAsync(api.wallet);
  const address = wallet.data?.address;

  /** Signed change of the available (ledger) balance, shown briefly as "+X SOL". */
  const [lastChange, setLastChange] = useState<bigint | null>(null);
  const previousAvailable = useRef<bigint | null>(null);
  const forceSync = useRef(false);

  const overview = useAsync(async () => {
    if (!address) return null;
    const next = forceSync.current ? await api.sync() : await api.overview();
    const value = BigInt(next.available.lamports);
    if (previousAvailable.current !== null && value !== previousAvailable.current) {
      setLastChange(value - previousAvailable.current);
    }
    previousAvailable.current = value;
    return next;
  }, [address]);
  const activity = useAsync(async () => (address ? api.activity(20) : null), [address]);

  /** User-initiated refresh: asks the server to sync with Devnet now. */
  const refresh = useCallback(async () => {
    forceSync.current = true;
    try {
      await overview.reload();
    } finally {
      forceSync.current = false;
    }
    await activity.reload();
  }, [overview, activity]);

  const pending =
    overview.data !== null &&
    (overview.data.pending.incomingLamports !== '0' || overview.data.pending.outgoingLamports !== '0');
  const interval = fastPolling || pending ? FAST_POLL_MS : SLOW_POLL_MS;
  const { reload: reloadOverview } = overview;
  const { reload: reloadActivity } = activity;

  useEffect(() => {
    if (!address) return;
    const timer = setInterval(() => {
      void reloadOverview({ silent: true }).then(() => reloadActivity({ silent: true }));
    }, interval);
    return () => clearInterval(timer);
  }, [address, interval, reloadOverview, reloadActivity]);

  useEffect(() => {
    if (lastChange === null) return;
    const t = setTimeout(() => setLastChange(null), 8000);
    return () => clearTimeout(t);
  }, [lastChange]);

  return { user, wallet, overview, activity, refresh, lastChange };
}

export type WalletState = ReturnType<typeof useWallet>;
