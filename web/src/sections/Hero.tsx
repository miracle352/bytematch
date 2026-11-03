import { useLayoutEffect, useRef } from 'react';
import { Omnibox } from '../components/Omnibox';
import { reducedMotion } from '../lib/format';
import { gsap } from '../lib/motion';
import './hero.css';

export function Hero() {
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .from('.hero-line > span', { yPercent: 110, duration: 1.1, stagger: 0.09 })
        .from('.hero .search', { opacity: 0, y: 14, duration: 0.9 }, '-=0.75');
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section className="hero" ref={root}>
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
      <Omnibox />
    </section>
  );
}
