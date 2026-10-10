import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError, type PageQuery } from '@warehouse/contracts';
import { list } from '../api/client';
export function usePagedQuery<T>(path: string, filters: PageQuery = {}) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const filterKey = JSON.stringify(filters);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const result = await list<T>(path, {
        ...(JSON.parse(filterKey) as PageQuery),
        page,
        pageSize: 20,
      });
      if (current === generation.current) {
        setRows(result.items);
      }
    } catch (failure) {
      if (current === generation.current) {
        setRows([]);
        setError(friendlyError(failure));
      }
    } finally {
      if (current === generation.current) {
        setLoading(false);
      }
    }
  }, [path, page, filterKey]);
  useEffect(() => {
    setPage(1);
  }, [path, filterKey]);
  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);
  return { rows, loading, error, page, setPage, reload };
}
