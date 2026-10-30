import { describe, expect, it } from 'vitest';
import { originalRequest } from '../src/rewrite.js';

describe('rewrite', () => {
  it('restores the original path and keeps the query', () => {
    const r = originalRequest(new Request('https://x.dev/api/index?__path=/v1/network&status=verified'));
    expect(new URL(r.url).pathname).toBe('/v1/network');
    expect(new URL(r.url).search).toBe('?status=verified');
  });

  it('keeps POST bodies', async () => {
    const r = originalRequest(new Request('https://x.dev/api/index?__path=/api&module=contract', { method: 'POST', body: 'a=1' }));
    expect(r.method).toBe('POST');
    expect(await r.text()).toBe('a=1');
  });

  it('leaves direct requests alone', () => {
    expect(new URL(originalRequest(new Request('https://x.dev/health')).url).pathname).toBe('/health');
  });
});
