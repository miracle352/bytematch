const HEX = '0123456789abcdef';

/** Resolve an element's text out of random hex, left to right. */
export function scramble(el: HTMLElement, final: string, ms = 900, delay = 0): () => void {
  let raf = 0;
  const start = performance.now() + delay;
  const tick = (now: number) => {
    const p = Math.min(1, Math.max(0, (now - start) / ms));
    const fixed = Math.floor(p * final.length);
    let s = final.slice(0, fixed);
    for (let i = fixed; i < final.length; i++) s += final[i] === ' ' ? ' ' : HEX[(Math.random() * 16) | 0];
    el.textContent = s;
    if (p < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
