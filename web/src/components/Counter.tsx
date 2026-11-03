import { useEffect, useRef } from 'react';
import { gsap } from '../lib/motion';
import { reducedMotion } from '../lib/format';

/** A number that counts up the first time it scrolls into view. */
export function Counter({ value, className }: { value: number; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  useEffect(() => {
    const node = el.current!;
    if (reducedMotion()) {
      node.textContent = value.toLocaleString('en-US');
      return;
    }
    const obj = { v: shown.current };
    let tween: gsap.core.Tween | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      tween = gsap.to(obj, {
        v: value,
        duration: 1.6,
        ease: 'expo.out',
        onUpdate: () => {
          shown.current = obj.v;
          node.textContent = Math.round(obj.v).toLocaleString('en-US');
        },
      });
    });
    io.observe(node);
    return () => {
      io.disconnect();
      tween?.kill();
    };
  }, [value]);
  return (
    <span ref={el} className={className}>
      0
    </span>
  );
}
