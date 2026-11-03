import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type StateValue } from '../lib/api';
import { reducedMotion } from '../lib/format';
import { gsap, refreshSoon } from '../lib/motion';
import { Counter } from '../components/Counter';
import './explorer.css';

const TOKEN = '0xe0114adc0a2072b602c645f5a07eefa1eadbdbc2';
const PLAQUE = '0x5432e6b89dc3042d47f2be98e971cad9dabab685';

/** Three things a verified ABI unlocks, scrolled sideways. */
export function Explorer() {
  const root = useRef<HTMLElement>(null);
  const [values, setValues] = useState<StateValue[] | null>(null);

  useEffect(() => {
    api.state(TOKEN).then((r) => setValues(r.values), () => setValues([]));
  }, []);

  useLayoutEffect(() => {
    if (reducedMotion() || window.innerWidth < 860) return;
    const ctx = gsap.context(() => {
      const track = root.current!.querySelector<HTMLElement>('.ex-track')!;
      const distance = () => track.scrollWidth - window.innerWidth;
      const tl = gsap.timeline({
        scrollTrigger: { trigger: '.ex-stage', start: 'top top', end: () => `+=${distance()}`, scrub: 0.8, pin: true, invalidateOnRefresh: true },
      });
      tl.to(track, { x: () => -distance(), ease: 'none', duration: 1 }, 0)
        // the proxy diagram draws itself as its panel arrives
        .fromTo('.ex-wire', { strokeDashoffset: 300 }, { strokeDashoffset: 0, ease: 'none', duration: 0.2 }, 0.3)
        .from('.ex-impl', { opacity: 0, x: -30, duration: 0.12 }, 0.42)
        .from('.ex-badge-big', { scale: 0.4, opacity: 0, rotate: -8, duration: 0.15, ease: 'back.out(2)' }, 0.62);
    }, root);
    return () => ctx.revert();
  }, []);

  useEffect(() => refreshSoon(), [values]);

  const supply = values?.find((v) => v.name === 'totalSupply');
  const decimals = Number(values?.find((v) => v.name === 'decimals')?.value ?? 0);

  return (
    <section className="ex" ref={root}>
      <div className="ex-stage">
        <div className="ex-track">
          <div className="ex-intro">
            <h2 className="h2">A verified ABI turns bytes into a contract you can use.</h2>
          </div>

          <article className="ex-panel">
            <h3 className="ex-h">Read it live</h3>
            <div className="ex-card ex-read">
              <p className="ex-live mono">
                <i /> Portal USDT · {TOKEN.slice(0, 8)}…
              </p>
              <dl>
                {(values ?? []).filter((v) => !v.error).map((v) => (
                  <div key={v.signature}>
                    <dt className="mono">{v.name}()</dt>
                    <dd className="mono">
                      {v === supply && decimals ? (
                        <>
                          <Counter value={Number(BigInt(String(v.value)) / 10n ** BigInt(decimals))} /> <small>pUSDT</small>
                        </>
                      ) : (
                        String(v.value)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <Link to={`/address/${TOKEN}`} className="ex-link">
                Call any view function
              </Link>
            </div>
          </article>

          <article className="ex-panel">
            <h3 className="ex-h">See through proxies</h3>
            <div className="ex-card ex-proxy">
              <svg viewBox="0 0 420 220" className="ex-diagram" aria-hidden="true">
                <path className="ex-wire" d="M150 110 C 210 110, 210 110, 270 110" pathLength={300} />
                <circle className="ex-pulse" r="5" cx="0" cy="0">
                  <animateMotion dur="1.8s" repeatCount="indefinite" path="M150 110 C 210 110, 210 110, 270 110" />
                </circle>
              </svg>
              <div className="ex-box ex-px">
                <span className="mono">0x…proxy</span>
                <strong>Proxy</strong>
                <span className="state state-unverified">no source</span>
              </div>
              <div className="ex-box ex-impl">
                <span className="mono">0x…logic</span>
                <strong>Implementation</strong>
                <span className="state state-exact">exact match</span>
              </div>
              <p className="ex-kinds mono">EIP-1967 · beacon · EIP-1167 clones</p>
            </div>
          </article>

          <article className="ex-panel">
            <h3 className="ex-h">Badge it</h3>
            <div className="ex-card ex-badge">
              <img className="ex-badge-big" src={`/badge/${PLAQUE}.svg`} alt="exact match badge" />
              <pre className="mono">{`[![source](…/badge/${PLAQUE.slice(0, 10)}….svg)]`}</pre>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
