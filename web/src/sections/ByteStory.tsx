import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { plaque } from '../data/plaque';
import { REGISTRY_ADDRESS } from '../lib/api';
import { reducedMotion, short } from '../lib/format';
import { gsap, ScrollTrigger } from '../lib/motion';
import './bytestory.css';

const deployed = plaque.deployed.match(/../g)!;
const rebuilt = plaque.rebuiltElsewhere.match(/../g)!;
const N = deployed.length;
const META_START = plaque.metadata.start;
const META_LEN = plaque.metadata.length;
const differing = deployed.map((b, i) => (b !== rebuilt[i] ? i : -1)).filter((i) => i >= 0);
const differSet = new Set(differing);

type Cell = 'hidden' | 'read' | 'match' | 'meta' | 'differ';

// Scroll progress is split into five steps. Boundaries are fractions of the pinned scroll.
const STEPS = [0, 0.17, 0.33, 0.62, 0.8, 1] as const;
const span = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));

function cellState(i: number, p: number): Cell {
  const readUpTo = span(p, 0, STEPS[1]) * N;
  if (i >= readUpTo) return 'hidden';
  const compared = span(p, STEPS[2], STEPS[3]) * N;
  if (i >= compared) return 'read';
  if (differSet.has(i)) {
    const fixed = span(p, STEPS[3], STEPS[4]) * differing.length;
    return differing.indexOf(i) < fixed ? 'match' : 'differ';
  }
  return i >= META_START ? 'meta' : 'match';
}

function counts(p: number) {
  let matched = 0;
  let differ = 0;
  for (let i = 0; i < N; i++) {
    const s = cellState(i, p);
    if (s === 'match' || s === 'meta') matched++;
    else if (s === 'differ') differ++;
  }
  return { matched, differ };
}

export function ByteStory() {
  const root = useRef<HTMLElement>(null);
  const cells = useRef<HTMLSpanElement[]>([]);
  const readout = useRef<{ matched: HTMLElement | null; differ: HTMLElement | null }>({ matched: null, differ: null });
  const [step, setStep] = useState(0);
  const still = useMemo(() => reducedMotion(), []);

  useLayoutEffect(() => {
    const paint = (p: number) => {
      for (let i = 0; i < N; i++) {
        const el = cells.current[i];
        if (!el) continue;
        const s = cellState(i, p);
        if (el.dataset.s !== s) el.dataset.s = s;
      }
      const c = counts(p);
      if (readout.current.matched) readout.current.matched.textContent = String(c.matched);
      if (readout.current.differ) readout.current.differ.textContent = String(c.differ);
      const idx = STEPS.findIndex((b, i) => i > 0 && p < b);
      setStep(idx === -1 ? STEPS.length - 2 : idx - 1);
    };

    if (still) {
      paint(1);
      return;
    }
    paint(0);
    const st = ScrollTrigger.create({
      trigger: '.bs-stage',
      start: 'top top',
      end: '+=420%',
      pin: true,
      scrub: true,
      onUpdate: (self) => paint(self.progress),
    });
    const ctx = gsap.context(() => {
      gsap.from('.bs-head > *', {
        opacity: 0,
        y: 24,
        stagger: 0.08,
        duration: 0.9,
        ease: 'expo.out',
        scrollTrigger: { trigger: '.bs', start: 'top 70%' },
      });
    }, root);
    return () => {
      st.kill();
      ctx.revert();
    };
  }, [still]);

  const stepsCopy = [
    {
      title: 'Read the chain',
      body: (
        <>
          <span className="mono">eth_getCode</span> returns the {N} bytes stored at{' '}
          <span className="mono">{short(plaque.address, 6, 4)}</span>. That is all the chain knows about this contract.
        </>
      ),
    },
    {
      title: 'Rebuild from source',
      body: (
        <>
          The Solidity from the project’s repository is compiled again with solc {plaque.compiler.split('+')[0]}, read from
          the deployed bytes themselves, and the settings the author used.
          <pre className="bs-src mono">{plaque.sourceExcerpt}</pre>
        </>
      ),
    },
    {
      title: 'Compare byte by byte',
      body: (
        <>
          The first {META_START} bytes are the program. The last {META_LEN} are metadata, a hash of the exact source text
          and file paths. Built under a different file path, {differing.length} of them differ: the same code with a
          different fingerprint. That is a partial match.
        </>
      ),
    },
    {
      title: 'Match every byte',
      body: <>Rebuilt with the file path the author used, the metadata matches too. Every byte agrees: an exact match.</>,
    },
    {
      title: 'Record it on chain',
      body: (
        <>
          The result goes into SourceRegistry on Portaldot, keyed by the code hash. Any contract can call{' '}
          <span className="mono">check()</span> before it trusts this code.
        </>
      ),
    },
  ];

  return (
    <section className="bs" id="how" ref={root} aria-label="How Bytematch checks a contract">
      <div className="wrap bs-head">
        <h2 className="h2">Byte by byte, on a real contract.</h2>
        <p className="lede">
          PlaqueLite is a name registry another Hacker House team deployed to the V3 testnet. Here is what Bytematch does
          with it.
        </p>
      </div>

      <div className={`bs-stage ${still ? 'bs-still' : ''}`}>
        <div className="wrap bs-grid">
          <ol className="bs-steps">
            {stepsCopy.map((s, i) => (
              <li key={s.title} className={still || i === step ? 'is-active' : i < step ? 'is-done' : ''} aria-current={i === step}>
                <span className="bs-n mono">{i + 1}</span>
                <div>
                  <h3 className="h3">{s.title}</h3>
                  <div className="bs-body">{s.body}</div>
                </div>
              </li>
            ))}
          </ol>

          <figure className="bs-figure">
            <div className="bs-hex mono" aria-label={`The ${N} deployed bytes of PlaqueLite`}>
              {deployed.map((b, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    if (el) cells.current[i] = el;
                  }}
                  data-s="hidden"
                  className={i >= META_START ? 'is-meta' : undefined}
                >
                  {b}
                </span>
              ))}
            </div>
            <figcaption className="bs-readout">
              <span>
                <strong ref={(el) => (readout.current.matched = el)}>0</strong> of {N} bytes match
              </span>
              <span className="bs-differ">
                <strong ref={(el) => (readout.current.differ = el)}>0</strong> differ
              </span>
              <span className="bs-legend">
                <i className="lg-program" /> program <i className="lg-meta" /> metadata
              </span>
            </figcaption>
            <div className={`bs-stamp ${still || step === 4 ? 'is-on' : ''}`}>
              <span className="state state-exact">Exact match</span>
              <span className="mono">code hash {short(plaque.codeHash, 10, 6)}</span>
              <span className="mono">SourceRegistry {short(REGISTRY_ADDRESS, 6, 4)}</span>
              <Link to={`/address/${plaque.address}`}>Open PlaqueLite</Link>
            </div>
          </figure>
        </div>
      </div>
    </section>
  );
}
