import { useEffect, useLayoutEffect, useRef } from 'react';
import { reducedMotion } from '../lib/format';
import { gsap, refreshSoon } from '../lib/motion';
import { useLive } from '../lib/useLive';
import { Counter } from '../components/Counter';
import './rootstory.css';

const W = 960;
const LEAVES = 8;
const ROW = [300, 210, 120, 30]; // y of each layer, leaves first

const x = (layer: number, i: number) => {
  const n = LEAVES >> layer;
  return (W / n) * (i + 0.5);
};

/** Verified contracts hash pairwise up to the one root SourceRoots stores. */
export function RootStory() {
  const root = useRef<HTMLElement>(null);
  const { recent, stats } = useLive();
  useEffect(() => refreshSoon(), [recent.length]);
  const names = [...new Set(recent.map((v) => v.contract.name))].slice(0, LEAVES);
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;

  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: '.rt-stage', start: 'top top', end: '+=200%', scrub: 0.6, pin: true },
      });
      tl.from('.rt-leaf', { opacity: 0, y: 30, stagger: 0.06, duration: 0.3 });
      for (let l = 1; l < ROW.length; l++) {
        tl.fromTo(`.rt-edge-${l}`, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.35 }).from(`.rt-node-${l}`, { scale: 0, transformOrigin: 'center', duration: 0.2 });
      }
      tl.to('.rt-node-3', { attr: { r: 22 }, duration: 0.2 }).from('.rt-facts > *', { opacity: 0, y: 20, stagger: 0.1, duration: 0.3 });
    }, root);
    return () => ctx.revert();
  }, []);

  const edges: Array<{ l: number; d: string }> = [];
  const nodes: Array<{ l: number; cx: number; cy: number }> = [];
  for (let l = 1; l < ROW.length; l++) {
    for (let i = 0; i < LEAVES >> l; i++) {
      const px = x(l, i), py = ROW[l]!;
      nodes.push({ l, cx: px, cy: py });
      for (const c of [2 * i, 2 * i + 1]) {
        const cx = x(l - 1, c), cy = ROW[l - 1]! - (l === 1 ? 14 : 0);
        edges.push({ l, d: `M${cx} ${cy} C ${cx} ${(cy + py) / 2}, ${px} ${(cy + py) / 2}, ${px} ${py}` });
      }
    }
  }

  return (
    <section className="rt" ref={root}>
      <div className="rt-stage">
        <div className="wrap">
          <h2 className="h2 rt-title">Every verification. One root on chain.</h2>
          <svg className="rt-svg" viewBox={`0 0 ${W} 340`} aria-hidden="true">
            {edges.map((e, i) => (
              <path key={i} className={`rt-edge rt-edge-${e.l}`} d={e.d} pathLength={1} />
            ))}
            {nodes.map((n, i) => (
              <circle key={i} className={`rt-node rt-node-${n.l}`} cx={n.cx} cy={n.cy} r={n.l === 3 ? 14 : 7} />
            ))}
            {Array.from({ length: LEAVES }, (_, i) => (
              <g key={i} className="rt-leaf" transform={`translate(${x(0, i)} ${ROW[0]})`}>
                <rect x={-52} y={-16} width={104} height={32} rx={8} />
                <text textAnchor="middle" dy="0.35em">
                  {narrow ? (names[i] ?? '').slice(0, 4) : (names[i] ?? '').slice(0, 13)}
                </text>
              </g>
            ))}
          </svg>
          <dl className="rt-facts">
            <div>
              <dd>
                <Counter value={stats?.total ?? 0} />
              </dd>
              <dt>verifications</dt>
            </div>
            <div>
              <dd>1</dd>
              <dt>storage slot</dt>
            </div>
            <div>
              <dd>~0.01</dd>
              <dt>tPOT per contract, not ~9</dt>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
