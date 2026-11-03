import { useLayoutEffect, useRef } from 'react';
import { plaque } from '../data/plaque';
import { reducedMotion } from '../lib/format';
import { gsap } from '../lib/motion';
import './cardstory.css';

const LINES = [
  'In 1950 you could hold a program up to the light.',
  `Today it is ${plaque.deployed.length / 2} bytes at an address.`,
];

const hexPairs = plaque.deployed.match(/../g)!;

/**
 * Starts as a framed photograph under the hero, opens to the full screen, then pushes
 * into the card in the punch until its holes become a real contract's bytes.
 */
export function CardStory() {
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap
        .timeline({
          defaults: { ease: 'none' },
          scrollTrigger: { trigger: '.cs-stage', start: 'top top', end: '+=240%', scrub: 0.6, pin: true },
        })
        .fromTo('.cs-frame', { clipPath: 'inset(0% 5% 8% 5% round 26px)' }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', duration: 0.6 }, 0)
        .fromTo('.cs-photo', { scale: 1.02 }, { scale: 2.7, duration: 2.6 }, 0.3)
        .from('.cs-line-0', { opacity: 0, y: 30, duration: 0.3 }, 0.55)
        .to('.cs-line-0', { opacity: 0, y: -30, duration: 0.3 }, 1.5)
        .to('.cs-shade', { opacity: 0.9, duration: 0.8 }, 1.7)
        .from('.cs-line-1', { opacity: 0, y: 30, duration: 0.3 }, 1.85)
        .from('.cs-bytes b', { opacity: 0, duration: 0.02, stagger: { each: 0.9 / hexPairs.length, from: 'start' } }, 1.9);
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section className="cs" ref={root} aria-label="A program you can see">
      <div className="cs-stage">
        <div className="cs-frame">
          <picture>
            <source srcSet="/img/keypunch-1950-1200.webp 1200w, /img/keypunch-1950-2200.webp 2200w" type="image/webp" />
            <img
              className="cs-photo"
              src="/img/keypunch-1950-1200.jpg"
              srcSet="/img/keypunch-1950-1200.jpg 1200w, /img/keypunch-1950-2200.jpg 2200w"
              sizes="100vw"
              alt="A keypunch operator at the 1950 US Census, punching a card."
            />
          </picture>
          <div className="cs-shade" />
          <div className="cs-bytes mono" aria-hidden="true">
            {hexPairs.map((h, i) => (
              <b key={i}>{h}</b>
            ))}
          </div>
          <div className="cs-captions wrap">
            {LINES.map((l, i) => (
              <p key={i} className={`cs-line cs-line-${i}`}>
                {l}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
