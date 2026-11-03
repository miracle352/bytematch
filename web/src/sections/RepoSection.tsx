import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RepoSummary } from '../lib/api';
import { rank, RepoTable } from '../pages/Repos';
import './reposection.css';

export function RepoSection() {
  const [items, setItems] = useState<RepoSummary[]>([]);
  useEffect(() => {
    api.repos().then((r) => setItems([...r.items].sort(rank)), () => {});
  }, []);

  const matched = items.reduce((n, r) => n + r.exact + r.partial, 0);
  const withCode = items.filter((r) => r.contracts > 0);

  return (
    <section className="rs">
      <div className="wrap">
        <h2 className="h2 rs-title">One repository in. Every contract it deployed, checked.</h2>
        {withCode.length > 0 && (
          <>
            <p className="rs-count">
              <span className="mono">{matched}</span> contracts across <span className="mono">{withCode.length}</span>{' '}
              Hacker House repositories
            </p>
            <RepoTable items={withCode.slice(0, 8)} />
            <Link to="/repos" className="btn btn-ghost rs-more">
              All repositories
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
