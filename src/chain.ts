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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status >= 500) throw new RpcError(method, res.status, `HTTP ${res.status}`);
        const json = (await res.json()) as { result?: T; error?: { code: number; message: string } };
        if (json.error) throw new RpcError(method, json.error.code, json.error.message);
        return json.result as T;
      } catch (e) {
        lastErr = e;
        // A JSON-RPC error is an answer, not a transport failure; don't retry it.
        if (e instanceof RpcError && e.code !== undefined && e.code < 500) throw e;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw lastErr;
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

  async findDeploymentBlock(address: string): Promise<number | null> {
    let hi = await this.blockNumber();
    if ((await this.getCode(address, hi)) === '0x') return null;
    let lo = 0; // invariant: no code at lo, code at hi
    if ((await this.getCode(address, lo)) !== '0x') return 0;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await this.getCode(address, mid)) === '0x') lo = mid;
      else hi = mid;
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
    for (const tx of block?.transactions ?? []) {
      if (tx.to !== null) continue;
      const receipt = await this.rpc<{ contractAddress: string | null }>('eth_getTransactionReceipt', [tx.hash]);
      if (receipt?.contractAddress?.toLowerCase() === target) {
        return { blockNumber, txHash: tx.hash, deployer: tx.from.toLowerCase(), input: tx.input.toLowerCase() };
      }
    }
    // Created by another contract (factory) or by a native extrinsic. Runtime matching
    // still works; we just can't recover constructor arguments from a tx input.
    return { blockNumber, txHash: null, deployer: null, input: null };
  }
}
