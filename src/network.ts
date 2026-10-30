// Every contract on the chain, and which of them have verified source.
//
// pallet-revive keeps one entry per account in Revive::AccountInfoOf, keyed by the raw
// H160 (Identity hasher), so the storage keys themselves are the addresses. We page
// through the keys over the Substrate RPC, then read each account's code over the EVM
// RPC: empty code means an EOA; otherwise we get the code hash, size and kind.

import { keccak256 } from 'ethers';
import type { Chain } from './chain.js';
import { isPolkaVm, strip0x } from './bytecode.js';
import type { Store } from './store.js';

// twox128("Revive") ++ twox128("AccountInfoOf")
export const ACCOUNT_INFO_PREFIX = '0x735f040a5d490f1107ad9c56f5ca00d2ae37ff0591fdbbcd9c2406df7147a9dc';

export interface OnChainContract {
  address: string;
  codeHash: string;
  kind: 'evm' | 'pvm';
  size: number; // bytes
}

export type CoverageStatus = 'verified' | 'same-code' | 'unverified';

export interface NetworkSnapshot {
  updatedAt: string;
  contracts: OnChainContract[];
}

async function substrate<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

export async function listAccounts(substrateUrl: string): Promise<string[]> {
  const out: string[] = [];
  let start: string | null = null;
  for (;;) {
    const keys: string[] = await substrate<string[]>(substrateUrl, 'state_getKeysPaged', [ACCOUNT_INFO_PREFIX, 1000, start]);
    for (const k of keys) out.push('0x' + k.slice(ACCOUNT_INFO_PREFIX.length).toLowerCase());
    if (keys.length < 1000) return out;
    start = keys.at(-1)!;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const SNAPSHOT_KEY = 'network:snapshot';
const KNOWN_KEY = 'network:known';

export class NetworkIndex {
  private snapshot: NetworkSnapshot | null = null;
  private refreshing: Promise<NetworkSnapshot> | null = null;
  // Contract code under pallet-revive only changes through set_code, so code read once
  // is reused; only accounts not seen before are fetched on refresh. Both the snapshot
  // and this map live in the store too, so serverless instances share them.
  private known = new Map<string, OnChainContract | null>();

  constructor(
    private readonly chain: Chain,
    private readonly substrateUrl: string,
    private readonly store: Store,
    private readonly maxAgeMs = 10 * 60_000,
  ) {}

  private isFresh(s: NetworkSnapshot | null): s is NetworkSnapshot {
    return !!s && Date.now() - Date.parse(s.updatedAt) < this.maxAgeMs;
  }

  async get(): Promise<NetworkSnapshot> {
    if (this.isFresh(this.snapshot)) return this.snapshot;
    const shared = await this.store.cacheGet<NetworkSnapshot>(SNAPSHOT_KEY).catch(() => null);
    if (this.isFresh(shared)) return (this.snapshot = shared);
    return this.refresh();
  }

  refresh(): Promise<NetworkSnapshot> {
    this.refreshing ??= this.load().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async load(): Promise<NetworkSnapshot> {
    if (!this.known.size) {
      const saved = await this.store.cacheGet<Array<[string, OnChainContract | null]>>(KNOWN_KEY).catch(() => null);
      for (const [a, c] of saved ?? []) this.known.set(a, c);
    }
    const addresses = await listAccounts(this.substrateUrl);
    const unseen = addresses.filter((a) => !this.known.has(a));
    await mapLimit(unseen, 4, async (address) => {
      const code = strip0x(await this.chain.getCode(address));
      this.known.set(
        address,
        code ? { address, codeHash: keccak256('0x' + code), kind: isPolkaVm(code) ? 'pvm' : 'evm', size: code.length / 2 } : null,
      );
    });
    const contracts = addresses.map((a) => this.known.get(a)).filter((c): c is OnChainContract => !!c);
    this.snapshot = { updatedAt: new Date().toISOString(), contracts };
    await Promise.all([
      this.store.cacheSet(SNAPSHOT_KEY, this.snapshot, Math.ceil(this.maxAgeMs / 1000)),
      unseen.length ? this.store.cacheSet(KNOWN_KEY, [...this.known], 30 * 86_400) : null,
    ]).catch(() => undefined);
    return this.snapshot;
  }
}

export interface CoverageRow extends OnChainContract {
  status: CoverageStatus;
  name: string | null;
  match: 'exact' | 'partial' | null;
  verifiedAs: string | null; // for same-code: the verified address it shares code with
}

export async function coverage(snapshot: NetworkSnapshot, store: Store) {
  const records = await store.listContracts(10_000);
  const byAddress = new Map(records.map((r) => [r.address, r]));
  const byCode = new Map<string, (typeof records)[number]>();
  for (const r of records) {
    const prev = byCode.get(r.codeHash);
    if (!prev || (r.level === 'exact' && prev.level !== 'exact')) byCode.set(r.codeHash, r);
  }
  const rows: CoverageRow[] = snapshot.contracts.map((c) => {
    const own = byAddress.get(c.address);
    if (own && own.codeHash === c.codeHash) {
      return { ...c, status: 'verified', name: own.contractName, match: own.level, verifiedAs: null };
    }
    const twin = byCode.get(c.codeHash);
    if (twin) return { ...c, status: 'same-code', name: twin.contractName, match: twin.level, verifiedAs: twin.address };
    return { ...c, status: 'unverified', name: null, match: null, verifiedAs: null };
  });
  const count = (s: CoverageStatus) => rows.filter((r) => r.status === s).length;
  return {
    updatedAt: snapshot.updatedAt,
    totals: {
      contracts: rows.length,
      evm: rows.filter((r) => r.kind === 'evm').length,
      pvm: rows.filter((r) => r.kind === 'pvm').length,
      uniqueCode: new Set(rows.map((r) => r.codeHash)).size,
      verified: count('verified'),
      sameCode: count('same-code'),
      unverified: count('unverified'),
    },
    contracts: rows,
  };
}
