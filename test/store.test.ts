// Both storage backends must behave the same. RedisStore runs against a minimal local
// stand-in for Upstash's REST pipeline endpoint.

import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisStore, SqliteStore, type ContractRecord, type Store } from '../src/store.js';

function fakeUpstash(): Promise<{ server: Server; url: string }> {
  const kv = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const zsets = new Map<string, Map<string, number>>();
  const run = (cmd: string[]): unknown => {
    const [op, key, ...rest] = cmd as [string, string, ...string[]];
    switch (op.toUpperCase()) {
      case 'SET': kv.set(key, rest[0]!); return 'OK';
      case 'GET': return kv.get(key) ?? null;
      case 'MGET': return [key, ...rest].map((k) => kv.get(k) ?? null);
      case 'HSET': { const h = hashes.get(key) ?? new Map(); h.set(rest[0]!, rest[1]!); hashes.set(key, h); return 1; }
      case 'HDEL': hashes.get(key)?.delete(rest[0]!); return 1;
      case 'HGETALL': return [...(hashes.get(key) ?? new Map())].flat();
      case 'ZADD': { const z = zsets.get(key) ?? new Map(); z.set(rest[1]!, Number(rest[0])); zsets.set(key, z); return 1; }
      case 'ZRANGE': {
        const sorted = [...(zsets.get(key) ?? new Map())].sort((a, b) => b[1] - a[1]).map(([m]) => m);
        return sorted.slice(Number(rest[0]), Number(rest[1]) + 1);
      }
      default: throw new Error(`fake upstash: ${op} not implemented`);
    }
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d)).on('end', () => {
      const cmds = JSON.parse(body) as string[][];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(cmds.map((c) => ({ result: run(c) }))));
    });
  });
  return new Promise((resolve) => server.listen(0, () => {
    const { port } = server.address() as { port: number };
    resolve({ server, url: `http://127.0.0.1:${port}` });
  }));
}

const record = (address: string, codeHash: string, level: 'exact' | 'partial', at: string): ContractRecord => ({
  address, codeHash, level, contractPath: 'A.sol', contractName: 'A', compilerVersion: '0.8.28+commit.7893614a',
  evmVersion: 'cancun', optimizer: { enabled: true, runs: 200 }, viaIR: false, abi: [], constructorArgs: '0x',
  creationTx: null, deployer: null, deployBlock: null, libraries: {}, digest: '0xd1',
  bundle: { schema: 'bytematch/bundle@1', compiler: '0.8.28', contract: 'A.sol:A', input: { language: 'Solidity', sources: {} } },
  verifiedAt: at, attestationTx: null,
});

let fake: { server: Server; url: string };
const backends: Array<[string, () => Promise<Store>]> = [
  ['sqlite', () => SqliteStore.open(mkdtempSync(join(tmpdir(), 'bm-')))],
  ['redis', async () => new RedisStore(fake.url, 'token')],
];

beforeAll(async () => { fake = await fakeUpstash(); });
afterAll(() => { fake.server.close(); });

describe.each(backends)('%s store', (_name, open) => {
  it('saves, finds by address and by code hash, and lists newest first', async () => {
    const s = await open();
    await s.saveContract(record('0xaa', '0xh1', 'partial', '2026-10-01T00:00:00Z'));
    await s.saveContract(record('0xbb', '0xh1', 'exact', '2026-10-02T00:00:00Z'));
    expect((await s.getContract('0xAA'))?.level).toBe('partial');
    expect((await s.findByCodeHash('0xh1'))?.address).toBe('0xbb'); // exact preferred
    expect((await s.listContracts()).map((r) => r.address)).toEqual(['0xbb', '0xaa']);
    expect(await s.countContracts()).toEqual({ total: 2, exact: 1 });
  });

  it('never replaces an exact match with a partial one for the same code', async () => {
    const s = await open();
    await s.saveContract(record('0xcc', '0xh2', 'exact', '2026-10-03T00:00:00Z'));
    expect(await s.saveContract(record('0xcc', '0xh2', 'partial', '2026-10-04T00:00:00Z'))).toBe(false);
    expect((await s.getContract('0xcc'))?.level).toBe('exact');
  });

  it('records attestations', async () => {
    const s = await open();
    await s.saveContract(record('0xdd', '0xh3', 'exact', '2026-10-05T00:00:00Z'));
    await s.setAttestation('0xdd', '0xtx');
    expect((await s.getContract('0xdd'))?.attestationTx).toBe('0xtx');
  });

  it('tracks jobs and cache entries', async () => {
    const s = await open();
    await s.createJob('j1', '0xee');
    expect((await s.getJob('j1'))?.status).toBe('pending');
    await s.finishJob('j1', 'pass', 'exact match');
    expect(await s.getJob('j1')).toMatchObject({ status: 'pass', message: 'exact match' });
    await s.cacheSet('k', { n: 1 }, 60);
    expect(await s.cacheGet('k')).toEqual({ n: 1 });
    expect(await s.cacheGet('missing')).toBeNull();
  });
});
