import { useEffect, useRef } from 'react';
import { reducedMotion } from '../lib/format';

/**
 * A field of real deployed bytes. A scan line sweeps across and the bytes it passes
 * light up as matched (cobalt) or metadata (amber); the pointer is a lens that
 * brightens and reshuffles the bytes under it.
 */
export function ByteField({ bytes }: { bytes: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const pairs = bytes.match(/../g)!;
    const CW = 30;
    const CH = 24;
    let w = 0, h = 0, cols = 0, rows = 0, dpr = 1;
    let glow = new Float32Array(0);
    let tone = new Uint8Array(0);
    let chars: string[] = [];
    const mouse = { x: -1e4, y: -1e4 };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CW) + 1;
      rows = Math.ceil(h / CH) + 1;
      glow = new Float32Array(cols * rows);
      tone = new Uint8Array(cols * rows);
      chars = Array.from({ length: cols * rows }, (_, i) => pairs[i % pairs.length]!);
      for (let i = 0; i < tone.length; i++) tone[i] = (i * 2654435761) % 97 < 9 ? 1 : 0; // a few metadata bytes
    };

    const draw = (t: number, still = false) => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = '500 11px "Martian Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      const beam = still ? -1 : ((t / 5200) % 1) * (cols + 12) - 6;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const x = c * CW + 6;
          const y = r * CH + 12;
          // the scan line, slightly slanted
          const d = Math.abs(c - (beam - r * 0.18));
          if (d < 0.8) glow[i] = 1;
          else glow[i] = glow[i]! * 0.985;
          const dx = x - mouse.x, dy = y - mouse.y;
          const lens = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 150);
          if (lens > 0.25 && Math.random() < 0.04) chars[i] = pairs[(Math.random() * pairs.length) | 0]!;
          const g = glow[i]!;
          const a = 0.09 + g * 0.75 + lens * 0.8;
          ctx.fillStyle =
            lens > g
              ? `rgba(255,255,255,${Math.min(1, a)})`
              : tone[i]
                ? `rgba(224,154,45,${Math.min(1, a)})`
                : `rgba(127,147,255,${Math.min(1, a)})`;
          ctx.fillText(chars[i]!, x, y);
        }
      }
    };

    resize();
    const still = reducedMotion();
    let raf = 0;
    let visible = true;
    const loop = (t: number) => {
      if (visible) draw(t);
      raf = requestAnimationFrame(loop);
    };
    if (still) draw(0, true);
    else raf = requestAnimationFrame(loop);

    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    io.observe(canvas);
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onLeave = () => ((mouse.x = -1e4), (mouse.y = -1e4));
    const host = canvas.parentElement!;
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    const ro = new ResizeObserver(() => {
      resize();
      if (still) draw(0, true);
    });
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [bytes]);

  return <canvas ref={ref} className="bytefield" aria-hidden="true" />;
}
