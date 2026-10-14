import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  /** True until the first non-null result (or an error). */
  loading: boolean;
  /** True while re-fetching with existing data on screen. */
  refreshing: boolean;
  /** `silent` refetches without the refreshing indicator (background polling). */
  reload: (options?: { silent?: boolean }) => Promise<T | null>;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasData = useRef(false);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  /** Fetches and stores the result. Only updates state after the await. */
  const run = useCallback(async () => {
    try {
      const result = await fnRef.current();
      if (result !== null) {
        hasData.current = true;
        setLoading(false);
      }
      setData(result);
      setError(null);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
      return null;
    } finally {
      setRefreshing(false);
    }
  }, []);

  const reload = useCallback(
    async (options?: { silent?: boolean }) => {
      if (hasData.current && !options?.silent) setRefreshing(true);
      return run();
    },
    [run],
  );

  useEffect(() => {
    // run() only sets state after awaiting the fetch, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refreshing, reload };
}
