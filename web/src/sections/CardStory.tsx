import { useLayoutEffect, useRef } from 'react';
import { plaque } from '../data/plaque';
import { reducedMotion } from '../lib/format';
import { gsap } from '../lib/motion';
import './cardstory.css';

const LINES = [
  'In 1950 a program was a stack of punched cards.',
  'Every instruction was a hole you could see. If you doubted a program, you held the card up to the light.',
  `Today a program is ${plaque.deployed.length / 2} bytes at an address. Nobody holds it up to the light.`,
];

const hexPairs = plaque.deployed.match(/../g)!;

export function CardStory() {
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: '.cs-stage', start: 'top top', end: '+=260%', scrub: 0.6, pin: true },
      });
      // The camera pushes in on the card in the punch, while the captions hand over.
      tl.fromTo('.cs-photo', { scale: 1.05 }, { scale: 2.7, duration: 3 }, 0)
        .to('.cs-shade', { opacity: 0.88, duration: 1 }, 1.9)
        .to('.cs-line-0', { opacity: 0, y: -30, duration: 0.3 }, 0.8)
        .from('.cs-line-1', { opacity: 0, y: 30, duration: 0.3 }, 0.95)
        .to('.cs-line-1', { opacity: 0, y: -30, duration: 0.3 }, 1.75)
        .from('.cs-line-2', { opacity: 0, y: 30, duration: 0.3 }, 2.05)
        // ...and the holes become bytes.
        .from('.cs-bytes b', { opacity: 0, duration: 0.02, stagger: { each: 0.9 / hexPairs.length, from: 'start' } }, 2.05);
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section className="cs" ref={root} aria-label="Why this matters">
      <div className="cs-stage">
        <picture>
          <source srcSet="/img/keypunch-1950-1200.webp 1200w, /img/keypunch-1950-2200.webp 2200w" type="image/webp" />
          <img
            className="cs-photo"
            src="/img/keypunch-1950-1200.jpg"
            srcSet="/img/keypunch-1950-1200.jpg 1200w, /img/keypunch-1950-2200.jpg 2200w"
            sizes="100vw"
            alt="A keypunch operator at the 1950 US Census, punching a card from a census sheet."
            loading="lazy"
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
    </section>
  );
}
