import { useEffect, useState } from 'react';

/** Current time, refreshed every `intervalMs` (default 1 min) for the "now" line and countdowns. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
