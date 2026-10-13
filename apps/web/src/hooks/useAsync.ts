import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True while re-fetching with existing data on screen. */
  refreshing: boolean;
  reload: () => Promise<T | null>;
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

  const reload = useCallback(async () => {
    if (hasData.current) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await fnRef.current();
      hasData.current = result !== null;
      setData(result);
      setError(null);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refreshing, reload };
}
