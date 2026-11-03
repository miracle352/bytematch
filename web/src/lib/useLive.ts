import { useEffect, useState } from 'react';
import { api, type RepoSummary, type Verification } from './api';

export interface Live {
  stats: { total: number; exact: number } | null;
  repos: RepoSummary[];
  recent: Verification[];
}

let cached: Promise<Live> | null = null;

/** The landing's live figures, fetched once per page load. */
export function useLive(): Live {
  const [live, setLive] = useState<Live>({ stats: null, repos: [], recent: [] });
  useEffect(() => {
    cached ??= Promise.all([
      fetch('/v1/stats').then((r) => r.json()).catch(() => null),
      api.repos().then((r) => r.items, () => []),
      api.recent(40).then((r) => r.items, () => []),
    ]).then(([stats, repos, recent]) => ({ stats, repos, recent }));
    let on = true;
    cached.then((l) => on && setLive(l));
    return () => {
      on = false;
    };
  }, []);
  return live;
}
