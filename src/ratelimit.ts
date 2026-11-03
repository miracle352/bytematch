/** Fixed-window counter per key. Per process, which is enough to blunt casual abuse. */
export class RateLimiter {
  private hits = new Map<string, { n: number; until: number }>();

  constructor(private readonly windowMs: number) {}

  take(key: string, max: number): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.until < now) {
      this.hits.set(key, { n: 1, until: now + this.windowMs });
      if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.until < now) this.hits.delete(k);
      return true;
    }
    h.n++;
    return h.n <= max;
  }
}
