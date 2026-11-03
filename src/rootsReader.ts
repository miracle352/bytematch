// Reads SourceRoots without a key: the attester's latest root, and the entry list
// published with it (from the RootPublished event), so the API can hand out proofs.

import { Contract, JsonRpcProvider, keccak256 } from 'ethers';
import { RootTree, type RootEntry } from './roots.js';
import { LEVEL_NAME, type OnChainAttestation } from './attest.js';

export const ROOTS_ABI = [
  'function publish(bytes32 root, bytes entries)',
  'function check(address target, address attester, uint8 level, bytes32 sourceDigest, bytes32[] proof) view returns (uint8)',
  'function roots(address attester, uint256 i) view returns (bytes32)',
  'event RootPublished(address indexed attester, bytes32 indexed root, bytes entries)',
];

export interface RootsAttestation extends OnChainAttestation {
  via: 'registry' | 'roots';
  root?: string;
  proof?: string[];
  tx?: string;
  block?: number;
}

export class RootsReader {
  readonly contract: Contract;
  private cache: { at: number; tree: RootTree | null; root: string; tx?: string; block?: number } | null = null;

  constructor(
    readonly provider: JsonRpcProvider,
    readonly address: string,
    readonly attester: string,
    private readonly fromBlock = 0,
  ) {
    this.contract = new Contract(address, ROOTS_ABI, provider);
  }

  /**
   * The tree behind the attester's current root. Each RootPublished event carries the
   * entries added since the one before (the first ones carried everything), so the tree
   * is the union of the attester's events up to the one that published the current root.
   */
  async tree(): Promise<RootTree | null> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.tree;
    const root = ((await this.contract.getFunction('roots').staticCall(this.attester, 0)) as string).toLowerCase();
    let tree: RootTree | null = null;
    let tx: string | undefined;
    let block: number | undefined;
    if (!/^0x0{64}$/.test(root)) {
      const logs = (await this.contract.queryFilter(this.contract.filters.RootPublished!(this.attester), this.fromBlock, 'latest')) as unknown as Array<{
        args: unknown[];
        transactionHash: string;
        blockNumber: number;
      }>;
      const entries: RootEntry[] = [];
      for (const log of logs) {
        // args[2] is `entries`; by name it would collide with Array.prototype.entries
        entries.push(...RootTree.unpack(log.args[2] as string));
        if ((log.args[1] as string).toLowerCase() === root) {
          const t = new RootTree(entries);
          if (t.root === root) {
            tree = t; // never serve proofs for a tree that doesn't hash to the on-chain root
            tx = log.transactionHash;
            block = log.blockNumber;
          }
        }
      }
    }
    this.cache = { at: Date.now(), tree, root, tx, block };
    return tree;
  }

  async entry(codeHash: string): Promise<{ entry: RootEntry; proof: string[]; root: string; tx?: string; block?: number } | null> {
    const tree = await this.tree();
    const entry = tree?.find(codeHash);
    if (!tree || !entry) return null;
    return { entry, proof: tree.proof(entry)!, root: tree.root, tx: this.cache?.tx, block: this.cache?.block };
  }
}

/** SourceRegistry first (one slot per code, from before roots), then SourceRoots. */
export function onChainReader(registry: { read(target: string): Promise<OnChainAttestation> } | null, roots: RootsReader | null) {
  if (!registry && !roots) return null;
  return {
    async read(target: string): Promise<RootsAttestation> {
      const direct = registry ? await registry.read(target).catch(() => null) : null;
      if (direct && direct.level !== 'none') return { ...direct, via: 'registry' };
      if (roots) {
        const code = await roots.provider.getCode(target);
        if (code !== '0x') {
          const hit = await roots.entry(keccak256(code)).catch(() => null);
          if (hit) return { level: LEVEL_NAME[hit.entry.level], sourceDigest: hit.entry.sourceDigest, via: 'roots', root: hit.root, proof: hit.proof, tx: hit.tx, block: hit.block };
        }
      }
      return { level: 'none', sourceDigest: '0x' + '00'.repeat(32), via: 'registry' };
    },
  };
}
