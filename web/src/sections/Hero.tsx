import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Omnibox } from '../components/Omnibox';
import { ByteField } from '../components/ByteField';
import { Counter } from '../components/Counter';
import { plaque } from '../data/plaque';
import { reducedMotion } from '../lib/format';
import { gsap } from '../lib/motion';
import { scramble } from '../lib/scramble';
import { useLive } from '../lib/useLive';
import './hero.css';

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const check = useRef<HTMLSpanElement>(null);
  const { stats, repos, recent } = useLive();

  useLayoutEffect(() => {
    if (reducedMotion()) return;
    let stop = () => {};
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .from('.hero-line > span', { yPercent: 115, duration: 1.2, stagger: 0.1 })
        .add(() => (stop = scramble(check.current!, 'Check it.', 1000)), 0.35)
        .from('.hero .search', { opacity: 0, y: 18, scale: 0.97, duration: 1 }, 0.7)
        .from('.hero-stats > *', { opacity: 0, y: 14, stagger: 0.08, duration: 0.9 }, 0.9);
      // The headline drifts up and fades as the photo takes over.
      gsap.to('.hero-center', {
        yPercent: -18,
        opacity: 0,
        ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true },
      });
    }, root);
    return () => {
      stop();
      ctx.revert();
    };
  }, []);

  const matched = repos.reduce((n, r) => n + r.exact + r.partial, 0);
  const ticker = recent.filter((v, i, a) => a.findIndex((x) => x.contract.name === v.contract.name) === i);

  return (
    <section className="hero" ref={root}>
      <ByteField bytes={plaque.deployed} />
      <div className="hero-center">
        <h1 className="display hero-title">
          <span className="hero-line">
            <span>Every contract</span>
          </span>
          <span className="hero-line">
            <span>claims a source.</span>
          </span>
          <span className="hero-line">
            <span ref={check} className="hero-check">
              Check it.
            </span>
          </span>
        </h1>
        <Omnibox typing />
        <dl className="hero-stats">
          <div>
            <dd>
              <Counter value={stats?.total ?? 0} />
            </dd>
            <dt>contracts verified</dt>
          </div>
          <div>
            <dd>
              <Counter value={repos.length} />
            </dd>
            <dt>repositories checked</dt>
          </div>
          <div>
            <dd>
              <Counter value={matched} />
            </dd>
            <dt>matched from a repo URL</dt>
          </div>
        </dl>
      </div>
      {ticker.length > 0 && (
        <div className="hero-ticker" aria-label="Recently verified">
          <div className="hero-track">
            {[...ticker, ...ticker].map((v, i) => (
              <Link key={i} to={`/address/${v.address}`} className="hero-tick" tabIndex={i < ticker.length ? 0 : -1}>
                <i className={`tick-${v.match}`} />
                {v.contract.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
