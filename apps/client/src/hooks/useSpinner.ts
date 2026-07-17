import { useState, useCallback } from 'react';

export function useSpinner() {
  const [loading, setLoading] = useState(false);

  const withSpinner = useCallback(async (fn: () => Promise<void>) => {
    if (loading) return;
    setLoading(true);
    try {
      await fn();
    } finally {
      setLoading(false);
    }
  }, [loading]);

  return { loading, withSpinner };
}
