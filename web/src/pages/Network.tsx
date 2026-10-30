import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PunchCard } from '../components/PunchCard';
import { useNetwork } from '../lib/useNetwork';
import { ago, short } from '../lib/format';
import type { CoverageStatus, NetworkRow } from '../lib/api';
import './page.css';
import './network.css';

const FILTERS: Array<[CoverageStatus | 'all', string]> = [
  ['all', 'All'],
  ['verified', 'Verified'],
  ['same-code', 'Same code'],
  ['unverified', 'Not verified'],
];

function statusText(r: NetworkRow) {
  if (r.status === 'verified') return r.match === 'exact' ? 'Exact match' : 'Partial match';
  if (r.status === 'same-code') return 'Same code';
  return 'Not verified';
}

function statusClass(r: NetworkRow) {
  if (r.status === 'unverified') return 'state-unverified';
  return r.match === 'partial' ? 'state-partial' : 'state-exact';
}

export function NetworkPage() {
  const { data, live } = useNetwork();
  const [filter, setFilter] = useState<CoverageStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const t = data.totals;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.contracts
      .filter((r) => filter === 'all' || r.status === filter)
      .filter((r) => !needle || r.address.includes(needle) || (r.name ?? '').toLowerCase().includes(needle))
      .sort((a, b) => Number(b.status !== 'unverified') - Number(a.status !== 'unverified'));
  }, [data, filter, q]);

  return (
    <div className="page wrap nw">
      <h1 className="page-title">Every contract on Portaldot V3</h1>
      <p className="lede">
        {t.verified + t.sameCode} of {t.contracts} have source anyone can check.{' '}
        {live ? `Read from the chain ${ago(data.updatedAt)}.` : `Snapshot from ${ago(data.updatedAt)}.`}
      </p>

      <PunchCard rows={data.contracts} caption={`${t.verified + t.sameCode} of ${t.contracts} contracts verified`} />

      <div className="nw-tools">
        <div className="nw-filters" role="group" aria-label="Filter by status">
          {FILTERS.map(([f, label]) => (
            <button key={f} className={filter === f ? 'is-on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {label}{' '}
              <span className="mono">
                {f === 'all' ? t.contracts : f === 'verified' ? t.verified : f === 'same-code' ? t.sameCode : t.unverified}
              </span>
            </button>
          ))}
        </div>
        <label className="nw-search">
          <span className="visually-hidden">Search by name or address</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or address" />
        </label>
      </div>

      <table className="nw-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Contract</th>
            <th>Address</th>
            <th className="nw-num">Size</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.address}>
              <td>
                <span className={`state ${statusClass(r)}`}>{statusText(r)}</span>
              </td>
              <td>{r.name ?? <span className="nw-dim">{r.kind === 'pvm' ? 'PolkaVM contract' : 'Unknown'}</span>}</td>
              <td>
                <Link className="mono" to={`/address/${r.address}`}>
                  {short(r.address, 10, 8)}
                </Link>
              </td>
              <td className="mono nw-num">{r.size.toLocaleString('en-US')} B</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="nw-empty">No contracts match “{q}”. Try part of an address or a contract name.</p>}
    </div>
  );
}
