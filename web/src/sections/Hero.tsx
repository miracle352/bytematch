import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AddressSearch } from '../components/AddressSearch';
import { Fingerprint } from '../components/Fingerprint';
import { showcase, type ShowcaseState } from '../data/showcase';
import { bytes, reducedMotion, short } from '../lib/format';
import { gsap } from '../lib/motion';
import './hero.css';

const STATE_LABEL: Record<ShowcaseState, string> = {
  exact: 'Exact match',
  partial: 'Partial match',
  mismatch: 'No match',
};

// Position, tilt, depth (parallax strength) and skin for each floating card.
const LAYOUT = [
  { slot: 'r1', rot: 6, depth: 26, skin: 'cobalt' },
  { slot: 'l1', rot: -6, depth: 18, skin: 'white' },
  { slot: 'l2', rot: 5, depth: 34, skin: 'amber' },
  { slot: 'r2', rot: -5, depth: 30, skin: 'ink' },
  { slot: 'l3', rot: -3, depth: 14, skin: 'ink' },
  { slot: 'r3', rot: 4, depth: 20, skin: 'white' },
] as const;

export function Hero() {
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = root.current!;
    const cards = gsap.utils.toArray<HTMLElement>('.hcard', el);
    if (reducedMotion()) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
      tl.from('.hero-line > span', { yPercent: 110, duration: 1.1, stagger: 0.09 })
        .from('.hero-sub, .hero-actions', { opacity: 0, y: 16, duration: 0.9, stagger: 0.08 }, '-=0.7')
        .from(
          cards,
          {
            opacity: 0,
            y: -80,
            rotation: (i) => LAYOUT[i]!.rot * 3,
            scale: 0.9,
            duration: 1.4,
            stagger: 0.07,
            ease: 'elastic.out(1, 0.75)',
          },
          '-=1',
        );
    }, el);

    // Cards drift against the pointer, each by its own depth.
    const movers = cards.map((c, i) => ({
      x: gsap.quickTo(c, 'x', { duration: 0.9, ease: 'power3' }),
      y: gsap.quickTo(c, 'y', { duration: 0.9, ease: 'power3' }),
      depth: LAYOUT[i]!.depth,
    }));
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      for (const m of movers) {
        m.x(-nx * m.depth);
        m.y(-ny * m.depth);
      }
    };
    el.addEventListener('pointermove', onMove);

    return () => {
      el.removeEventListener('pointermove', onMove);
      ctx.revert();
    };
  }, []);

  return (
    <section className="hero" ref={root}>
      <div className="hero-cards">
        {showcase.map((c, i) => {
          const l = LAYOUT[i]!;
          return (
            <Link
              key={c.address}
              to={`/address/${c.address}`}
              className={`hcard hcard-${l.skin} hcard-${l.slot}`}
              style={{ ['--rot' as string]: `${l.rot}deg` }}
            >
              <span className="hcard-project">{c.project}</span>
              <span className="hcard-name">{c.name}</span>
              <Fingerprint codeHash={c.codeHash} />
              <span className="hcard-foot">
                <span className={`state state-${c.state}`}>{STATE_LABEL[c.state]}</span>
                <span className="mono hcard-size">{bytes(c.size)}</span>
              </span>
              <span className="mono hcard-addr">{short(c.address, 8, 6)}</span>
            </Link>
          );
        })}
      </div>

      <div className="hero-center">
        <h1 className="display hero-title">
          <span className="hero-line">
            <span>Every contract</span>
          </span>
          <span className="hero-line">
            <span>claims a source.</span>
          </span>
          <span className="hero-line">
            <span>Check it.</span>
          </span>
        </h1>
        <p className="lede hero-sub">
          Paste a Portaldot address. Bytematch rebuilds the Solidity, compares it with the deployed bytes one by one,
          and records the result on chain.
        </p>
        <div className="hero-actions">
          <AddressSearch />
          <Link to="/verify" className="hero-secondary">
            Verify your own contract
          </Link>
        </div>
      </div>
    </section>
  );
}
