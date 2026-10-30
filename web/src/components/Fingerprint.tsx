import { nibbles } from '../lib/format';

/** A contract's runtime code hash drawn as 64 cells, one per hex digit. */
export function Fingerprint({ codeHash, cols = 16 }: { codeHash: string; cols?: number }) {
  return (
    <div className="fp" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} aria-hidden="true">
      {nibbles(codeHash).map((n, i) => (
        <span key={i} style={{ opacity: 0.14 + (n / 15) * 0.86 }} />
      ))}
    </div>
  );
}
