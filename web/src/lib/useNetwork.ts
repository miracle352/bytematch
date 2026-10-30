import { useEffect, useState } from 'react';
import { api, type Network } from './api';
import snapshot from '../data/network-snapshot.json';

/** Live coverage from the API; falls back to the snapshot bundled at build time. */
export function useNetwork() {
  const [state, setState] = useState<{ data: Network; live: boolean; loading: boolean }>({
    data: snapshot as Network,
    live: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    api
      .network()
      .then((data) => !cancelled && setState({ data, live: true, loading: false }))
      .catch(() => !cancelled && setState((s) => ({ ...s, loading: false })));
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
