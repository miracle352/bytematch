// README badge: "bytematch | exact match". Plain SVG, no external fonts or requests.

const COLORS = { exact: '#3550ff', partial: '#e09a2d', unverified: '#8a93a3', none: '#8a93a3' } as const;

// Approximate advance widths of 11px Verdana, enough to size the two halves.
const width = (s: string) => Math.round([...s].reduce((w, ch) => w + (/[ilj.:,'|]/.test(ch) ? 3.5 : /[mw]/.test(ch) ? 10 : /[A-Z]/.test(ch) ? 7.5 : 6.6), 0)) + 12;

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

export function badgeSvg(state: keyof typeof COLORS, text: string): string {
  const left = 'bytematch';
  const lw = width(left);
  const rw = width(text);
  const w = lw + rw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(left)}: ${esc(text)}">
<title>${esc(left)}: ${esc(text)}</title>
<clipPath id="r"><rect width="${w}" height="20" rx="3"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#101828"/><rect x="${lw}" width="${rw}" height="20" fill="${COLORS[state]}"/></g>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${lw / 2}" y="14">${esc(left)}</text><text x="${lw + rw / 2}" y="14">${esc(text)}</text></g>
</svg>`;
}
