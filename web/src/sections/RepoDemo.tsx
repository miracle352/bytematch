import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RepoReport } from '../lib/api';
import { REPO_STATE } from '../pages/Repo';
import { rank, RepoTable } from '../pages/Repos';
import { bytes, reducedMotion, short } from '../lib/format';
import { useLive } from '../lib/useLive';
import './repodemo.css';
import { refreshSoon } from '../lib/motion';

const DEMO = 'Junedkhan121/portalswap';
const STEPS = ['Reading the repository', 'Finding its contracts on chain', 'Compiling and comparing'];

/** A real repository report, played back the way the scan ran. */
export function RepoDemo() {
  const root = useRef<HTMLElement>(null);
  const [report, setReport] = useState<RepoReport | null>(null);
  const [typed, setTyped] = useState(0);
  const [step, setStep] = useState(-1);
  const [shown, setShown] = useState(0);
  const [resolved, setResolved] = useState(0);
  const [run, setRun] = useState(0);
  const { repos } = useLive();

  useEffect(() => {
    api.repo(DEMO).then(setReport, () => {});
  }, []);

  useEffect(() => refreshSoon(), [report, repos.length]);

  const url = `github.com/${report?.repo ?? DEMO}`;
  const rows = (report?.contracts ?? []).slice(0, 9);

  useEffect(() => {
    if (!report) return;
    if (reducedMotion()) {
      setTyped(url.length), setStep(3), setShown(rows.length), setResolved(rows.length);
      return;
    }
    const timers: number[] = [];
    const at = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
    let started = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting || started) return;
        started = true;
        setTyped(0), setStep(-1), setShown(0), setResolved(0);
        let t = 200;
        for (let i = 1; i <= url.length; i++) at((t += 38), () => setTyped(i));
        STEPS.forEach((_, i) => at((t += 520), () => setStep(i)));
        rows.forEach((_, i) => {
          at((t += 230), () => setShown(i + 1));
          at(t + 520, () => setResolved(i + 1));
        });
        at(t + 600, () => setStep(3));
      },
      { threshold: 0.45 },
    );
    io.observe(root.current!.querySelector('.rd-window')!);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, run]);

  const exact = rows.slice(0, resolved).filter((c) => c.status === 'exact').length;
  const others = [...repos].sort(rank).filter((r) => r.contracts > 0);

  return (
    <section className="rdm" ref={root}>
      <div className="wrap">
        <h2 className="h2 rdm-title">One repository in. Every contract it deployed, checked.</h2>

        <div className="rd-window">
          <div className="rd-bar">
            <i />
            <i />
            <i />
            <span className="mono rd-url">
              {url.slice(0, typed)}
              <b className={typed < url.length ? 'rd-caret' : 'rd-caret rd-caret-done'} />
            </span>
            <button className="rd-replay" onClick={() => setRun((r) => r + 1)} aria-label="Replay">
              ↻
            </button>
          </div>
          <div className="rd-body">
            <ol className="rd-steps mono">
              {STEPS.map((s, i) => (
                <li key={s} className={step > i ? 'is-done' : step === i ? 'is-on' : ''}>
                  {s}
                </li>
              ))}
            </ol>
            <ul className="rd-rows">
              {rows.map((c, i) => {
                const st = REPO_STATE[c.status];
                const done = i < resolved;
                return (
                  <li key={c.address} className={i < shown ? (done ? 'is-in is-done' : 'is-in') : ''}>
                    <span className="rd-name">{c.name ?? short(c.address)}</span>
                    <span className="mono rd-addr">{short(c.address, 6, 4)}</span>
                    <span className="mono rd-size">{bytes(c.size)}</span>
                    <span className="rd-result">
                      {done ? <span className={`state ${st.cls}`}>{st.text}</span> : <span className="rd-bar-load" />}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className={`rd-total ${step >= 3 ? 'is-on' : ''}`}>
              <span className="mono">{exact}</span> of <span className="mono">{rows.length}</span> exact, from one URL.{' '}
              <Link to={`/repo/${report?.repo ?? DEMO}`}>Open</Link>
            </p>
          </div>
        </div>

        {others.length > 0 && (
          <div className="rdm-table">
            <RepoTable items={others.slice(0, 10)} />
            <Link to="/repos" className="btn btn-ghost">
              All {others.length} repositories
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
