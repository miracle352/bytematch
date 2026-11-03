import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, type RepoReport, type RepoStatus } from '../lib/api';
import { ago, bytes, short } from '../lib/format';
import './page.css';
import './repo.css';
import { Copy } from '../components/Copy';

export const REPO_STATE: Record<RepoStatus, { text: string; cls: string }> = {
  exact: { text: 'Exact match', cls: 'state-exact' },
  partial: { text: 'Partial match', cls: 'state-partial' },
  no_match: { text: 'Not matched', cls: 'state-mismatch' },
  polkavm: { text: 'PolkaVM', cls: 'state-unverified' },
};

function useElapsed(running: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!running) return;
    setS(0);
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  return s;
}

export function RepoPage() {
  const { owner = '', name = '' } = useParams();
  const repo = `${owner}/${name}`;
  const [report, setReport] = useState<RepoReport | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [scanning, setScanning] = useState(false);
  const elapsed = useElapsed(scanning);

  const scan = () => {
    setError(null);
    setScanning(true);
    api
      .scanRepo(`https://github.com/${repo}`)
      .then(setReport, setError)
      .finally(() => setScanning(false));
  };

  useEffect(() => {
    setReport(null);
    setError(null);
    api.repo(repo).then(setReport, (e: ApiError) => (e.status === 404 ? scan() : setError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  const head = (
    <h1 className="page-title rp-title">
      <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">
        <span className="rp-owner">{owner}/</span>
        {name}
      </a>
    </h1>
  );

  if (error) {
    return (
      <div className="page wrap rp">
        {head}
        <p className="lede">{error.message}</p>
        <button className="btn btn-primary" onClick={scan}>
          Try again
        </button>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="page wrap rp" aria-busy="true">
        {head}
        <ol className="rp-progress mono">
          <li className={elapsed >= 0 ? 'is-on' : ''}>Reading the repository</li>
          <li className={elapsed >= 4 ? 'is-on' : ''}>Finding its contracts on chain</li>
          <li className={elapsed >= 9 ? 'is-on' : ''}>Compiling and comparing</li>
        </ol>
        {scanning && <p className="mono rp-time">{elapsed}s</p>}
      </div>
    );
  }

  const n = (s: RepoStatus) => report.contracts.filter((c) => c.status === s).length;
  const tally = [
    { k: 'exact', v: n('exact'), label: 'exact' },
    { k: 'partial', v: n('partial'), label: 'partial' },
    { k: 'mismatch', v: n('no_match'), label: 'not matched' },
  ];

  return (
    <div className="page wrap rp">
      {head}

      {report.contracts.length > 0 ? (
        <>
          <dl className="rp-tally">
            {tally.map((t) => (
              <div key={t.k} className={`rp-t rp-t-${t.k}`}>
                <dd>{t.v}</dd>
                <dt>{t.label}</dt>
              </div>
            ))}
          </dl>

          <ul className="rp-list">
            {report.contracts.map((c) => {
              const st = REPO_STATE[c.status];
              return (
                <li key={c.address}>
                  <Link to={`/address/${c.address}`}>
                    <span className={`state ${st.cls}`}>{st.text}</span>
                    <span className="rp-name">{c.name ?? short(c.address, 8, 6)}</span>
                    <span className="mono rp-addr">{short(c.address, 8, 6)}</span>
                    <span className="mono rp-size">{bytes(c.size)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="lede">No address in this repository has code on Portaldot V3.</p>
      )}

      <footer className="rp-foot">
        <ul className="rp-projects mono">
          {report.projects.map((p) => (
            <li key={p.root}>
              {p.root || '.'} · {p.tool} · {p.sources} files{p.compiler ? ` · solc ${p.compiler.split('+')[0]}` : ''}
              {p.problem && <span className="rp-problem"> · {p.problem}</span>}
            </li>
          ))}
        </ul>
        {report.contracts.some((c) => c.status === 'exact' || c.status === 'partial') && (
          <p className="rp-badges">
            README badges for every match{' '}
            <Copy
              value={report.contracts
                .filter((c) => c.status === 'exact' || c.status === 'partial')
                .map((c) => `[![${c.name ?? c.address}](${location.origin}/badge/${c.address}.svg)](${location.origin}/address/${c.address})`)
                .join('\n')}
            />
          </p>
        )}
        <p className="rp-when">
          {report.incomplete && 'Stopped at the time limit; not every setting was tried. '}
          Checked {ago(report.scannedAt)} ·{' '}
          <button className="rp-again" onClick={scan} disabled={scanning}>
            {scanning ? `checking… ${elapsed}s` : 'check again'}
          </button>
        </p>
      </footer>
    </div>
  );
}
