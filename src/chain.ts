// Thin JSON-RPC client for the Portaldot V3 EVM endpoint, plus the one non-obvious
// operation we need: finding the transaction that created a contract.
//
// Portaldot has no "getContractCreation" call and the public indexers start part-way
// through the chain, but the RPC keeps historical state. So we binary-search
// eth_getCode over block heights to find the first block where the code exists, then
// look for the creating transaction inside that block. ~18 calls at 250k blocks.

export interface Creation {
  blockNumber: number;
  // null when the contract was created by another contract or a native extrinsic.
  txHash: string | null;
  deployer: string | null;
  // Raw tx input: init code followed by ABI-encoded constructor arguments.
  input: string | null;
}

type Hex = string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RpcError extends Error {
  constructor(public method: string, public code: number | undefined, message: string) {
    super(`${method}: ${message}`);
  }
}

export class Chain {
  private nextId = 1;

  constructor(public readonly url: string, private readonly timeoutMs = 20_000) {}

  async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params });
    let lastErr: unknown;
    // The public node answers 503/429 under load; back off 0.4, 0.8, 1.6, 3.2s.
    for (let attempt = 0; attempt < 5; attempt++) {
      let res: Response;
      try {
        res = await fetch(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        lastErr = e; // network error or timeout: retry
        await sleep(400 * 2 ** attempt);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new RpcError(method, res.status, `HTTP ${res.status}`);
        await sleep(400 * 2 ** attempt);
        continue;
      }
      const json = (await res.json()) as { result?: T; error?: { code: number; message: string } };
      // A JSON-RPC error is an answer, not a transport failure; don't retry it.
      if (json.error) throw new RpcError(method, json.error.code, json.error.message);
      return json.result as T;
    }
    throw lastErr;
  }

  /** Several calls in one HTTP round trip. Results come back in request order. */
  async batch<T>(calls: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    if (!calls.length) return [];
    const firstId = this.nextId;
    this.nextId += calls.length;
    const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: firstId + i, ...c })));
    // Same backoff as rpc(): the public node answers 503/429 under load.
    let res: Response | null = null;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        res = await fetch(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        lastErr = e;
        res = null;
        await sleep(400 * 2 ** attempt);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new RpcError('batch', res.status, `HTTP ${res.status}`);
        res = null;
        await sleep(400 * 2 ** attempt);
        continue;
      }
      break;
    }
    if (!res) throw lastErr;
    if (!res.ok) throw new RpcError('batch', res.status, `HTTP ${res.status}`);
    const json = (await res.json()) as Array<{ id: number; result?: T; error?: { code: number; message: string } }>;
    const byId = new Map(json.map((r) => [r.id, r]));
    return calls.map((c, i) => {
      const r = byId.get(firstId + i);
      if (!r) throw new RpcError(c.method, undefined, 'missing from batch response');
      if (r.error) throw new RpcError(c.method, r.error.code, r.error.message);
      return r.result as T;
    });
  }

  async call(to: string, data: string): Promise<Hex> {
    return this.rpc<Hex>('eth_call', [{ to, data }, 'latest']);
  }

  async storageAt(address: string, slot: string): Promise<Hex> {
    return this.rpc<Hex>('eth_getStorageAt', [address, slot, 'latest']);
  }

  async chainId(): Promise<number> {
    return Number(await this.rpc<Hex>('eth_chainId', []));
  }

  async blockNumber(): Promise<number> {
    return Number(await this.rpc<Hex>('eth_blockNumber', []));
  }

  async getCode(address: string, block: number | 'latest' = 'latest'): Promise<Hex> {
    const tag = block === 'latest' ? 'latest' : '0x' + block.toString(16);
    return (await this.rpc<Hex>('eth_getCode', [address, tag])).toLowerCase();
  }

  // Separate parallel requests, not one batch: the node answers a batch's historical
  // state lookups one after another (measured ~10x slower), but serves parallel
  // requests concurrently.
  private async codeExistsAt(address: string, heights: number[]): Promise<boolean[]> {
    return Promise.all(heights.map(async (h) => (await this.getCode(address, h)) !== '0x'));
  }

  async findDeploymentBlock(address: string): Promise<number | null> {
    let hi = await this.blockNumber();
    const [atHead, atGenesis] = await this.codeExistsAt(address, [hi, 0]);
    if (!atHead) return null;
    if (atGenesis) return 0;
    let lo = 0; // invariant: no code at lo, code at hi
    // Each round probes WAYS heights in parallel: ~6 round trips for 250k blocks, ~3s.
    // The public node slows down past ~8 concurrent historical lookups.
    const WAYS = 8;
    while (hi - lo > 1) {
      const step = Math.max(1, Math.floor((hi - lo) / WAYS));
      const points: number[] = [];
      for (let p = lo + step; p < hi; p += step) points.push(p);
      const present = await this.codeExistsAt(address, points);
      const first = present.indexOf(true);
      if (first === -1) lo = points.at(-1) ?? lo;
      else {
        hi = points[first]!;
        if (first > 0) lo = points[first - 1]!;
      }
    }
    return hi;
  }

  // Deployments don't move, so a found creation can be remembered for the process lifetime.
  private creations = new Map<string, Creation>();

  async findCreation(address: string): Promise<Creation | null> {
    const target = address.toLowerCase();
    const known = this.creations.get(target);
    if (known) return known;
    const found = await this.searchCreation(target);
    if (found) this.creations.set(target, found);
    return found;
  }

  private async searchCreation(target: string): Promise<Creation | null> {
    const blockNumber = await this.findDeploymentBlock(target);
    if (blockNumber === null) return null;
    const block = await this.rpc<{ transactions: Array<{ hash: string; to: string | null; from: string; input: string }> }>(
      'eth_getBlockByNumber',
      ['0x' + blockNumber.toString(16), true],
    );
    const deploys = (block?.transactions ?? []).filter((tx) => tx.to === null);
    const receipts = await this.batch<{ contractAddress: string | null } | null>(
      deploys.map((tx) => ({ method: 'eth_getTransactionReceipt', params: [tx.hash] })),
    );
    const i = receipts.findIndex((r) => r?.contractAddress?.toLowerCase() === target);
    const tx = deploys[i];
    if (tx) return { blockNumber, txHash: tx.hash, deployer: tx.from.toLowerCase(), input: tx.input.toLowerCase() };
    // Created by another contract (factory) or by a native extrinsic. Runtime matching
    // still works; we just can't recover constructor arguments from a tx input.
    return { blockNumber, txHash: null, deployer: null, input: null };
  }
}
