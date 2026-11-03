import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RepoSummary } from '../lib/api';
import { Omnibox } from '../components/Omnibox';
import './page.css';
import './repo.css';

export const rank = (a: RepoSummary, b: RepoSummary) =>
  b.exact + b.partial - (a.exact + a.partial) || b.exact - a.exact || b.contracts - a.contracts || a.repo.localeCompare(b.repo);

export function ReposPage() {
  const [items, setItems] = useState<RepoSummary[] | null>(null);
  useEffect(() => {
    api.repos().then((r) => setItems([...r.items].sort(rank)), () => setItems([]));
  }, []);

  return (
    <div className="page wrap rp">
      <h1 className="page-title">Repositories</h1>
      <div className="rp-box">
        <Omnibox />
      </div>
      {items === null ? (
        <p className="mono ad-loading">Loading…</p>
      ) : (
        <RepoTable items={items} />
      )}
    </div>
  );
}

export function RepoTable({ items }: { items: RepoSummary[] }) {
  return (
    <table className="rp-table">
      <thead>
        <tr>
          <th>Repository</th>
          <th className="num">On chain</th>
          <th className="num rp-h-exact">Exact</th>
          <th className="num rp-h-partial">Partial</th>
          <th className="num rp-h-mismatch">Not matched</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.repo}>
            <td>
              <Link to={`/repo/${r.repo}`}>
                <span className="rp-owner">{r.repo.split('/')[0]}/</span>
                {r.repo.split('/')[1]}
              </Link>
            </td>
            <td className="num">{r.contracts}</td>
            <td className="num">{r.exact || ''}</td>
            <td className="num">{r.partial || ''}</td>
            <td className="num">{r.differ || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
