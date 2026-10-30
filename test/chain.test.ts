import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Chain } from '../src/chain.js';

// A node that answers 503 to every other request, like the public testnet node under load.
let server: Server;
let url = '';
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      hits++;
      if (hits % 2 === 1) {
        res.statusCode = 503;
        return res.end('busy');
      }
      const reqs = JSON.parse(body);
      const answer = (r: { id: number }) => ({ jsonrpc: '2.0', id: r.id, result: '0x2a' });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(Array.isArray(reqs) ? reqs.map(answer) : answer(reqs)));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
});

describe('Chain retries on a busy node', () => {
  it('single calls', async () => {
    expect(await new Chain(url).blockNumber()).toBe(42);
  });

  it('batched calls', async () => {
    const out = await new Chain(url).batch<string>([
      { method: 'eth_getTransactionReceipt', params: ['0x1'] },
      { method: 'eth_getTransactionReceipt', params: ['0x2'] },
    ]);
    expect(out).toEqual(['0x2a', '0x2a']);
  });
});
