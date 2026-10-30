// Two bars of bytes, the lower one sliding into line with the upper: a match.
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="5" rx="1.6" fill="var(--exact)" />
      <rect className="logo-lower" x="3" y="14" width="18" height="5" rx="1.6" fill="currentColor" />
    </svg>
  );
}
