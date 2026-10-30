export const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

export function short(hex: string, head = 6, tail = 4): string {
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

export const bytes = (n: number) => `${n.toLocaleString('en-US')} bytes`;

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The 64 nibbles of a code hash, 0-15, used to draw a contract's fingerprint. */
export function nibbles(codeHash: string): number[] {
  return [...codeHash.replace(/^0x/, '')].map((c) => parseInt(c, 16));
}

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
