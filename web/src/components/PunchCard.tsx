import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NetworkRow } from '../lib/api';
import { bytes, reducedMotion, short } from '../lib/format';
import { gsap } from '../lib/motion';
import './punchcard.css';

function holeClass(r: NetworkRow) {
  if (r.status === 'unverified') return 'h-blank';
  if (r.match === 'partial') return 'h-partial';
  return r.status === 'same-code' ? 'h-twin' : 'h-exact';
}

function describe(r: NetworkRow) {
  if (r.status === 'verified') return `${r.name}: ${r.match} match`;
  if (r.status === 'same-code') return `${r.name}: same code as a verified contract`;
  return r.kind === 'pvm' ? 'PolkaVM contract, not verified' : 'Not verified';
}

/**
 * Every contract on the chain as one position on a punched card. A verified contract is
 * punched through, so the light shows; an unverified one is still blank card.
 */
export function PunchCard({ rows, caption }: { rows: NetworkRow[]; caption: string }) {
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [tip, setTip] = useState<{ r: NetworkRow; x: number; y: number } | null>(null);
  const key = rows.map((r) => r.status[0]).join('');

  useLayoutEffect(() => {
    if (reducedMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      // fromTo, not from: if live data replaces the snapshot mid-animation, a from() would
      // capture the half-grown size as its end state.
      gsap.fromTo(
        '.pc-holes .hole:not(.h-blank)',
        { scale: 0, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.5,
          ease: 'back.out(3)',
          stagger: { each: 0.03, from: 'random' },
          clearProps: 'transform,opacity',
          scrollTrigger: { trigger: root.current, start: 'top 75%', once: true },
        },
      );
    }, root);
    return () => ctx.revert();
  }, [key]);

  return (
    <div className="pc-wrap" ref={root}>
      <div className="pc" role="img" aria-label={caption}>
        <div className="pc-print mono" aria-hidden="true">
          <span>Portaldot V3</span>
          <span>chain 420420777</span>
          <span>{rows.length} contracts</span>
        </div>
        <div className="pc-holes" onPointerLeave={() => setTip(null)}>
          {rows.map((r) => (
            <span
              key={r.address}
              className={`hole ${holeClass(r)}`}
              onPointerEnter={(e) => {
                const box = root.current!.getBoundingClientRect();
                const h = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setTip({ r, x: h.left - box.left + h.width / 2, y: h.top - box.top });
              }}
              onClick={() => navigate(`/address/${r.address}`)}
            />
          ))}
        </div>
      </div>
      {tip && (
        <div className="pc-tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
          <strong>{describe(tip.r)}</strong>
          <span className="mono">{short(tip.r.address, 8, 6)}</span>
          <span>{bytes(tip.r.size)}</span>
        </div>
      )}
      <ul className="pc-legend">
        <li><i className="hole h-exact" /> Verified</li>
        <li><i className="hole h-twin" /> Same code as a verified contract</li>
        <li><i className="hole h-partial" /> Partial match</li>
        <li><i className="hole h-blank" /> Not verified</li>
      </ul>
    </div>
  );
}
