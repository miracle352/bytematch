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
}

export class RootsReader {
  readonly contract: Contract;
  private cache: { at: number; tree: RootTree | null; root: string } | null = null;

  constructor(
    readonly provider: JsonRpcProvider,
    readonly address: string,
    readonly attester: string,
    private readonly fromBlock = 0,
  ) {
    this.contract = new Contract(address, ROOTS_ABI, provider);
  }

  /** The tree behind the attester's current root, rebuilt from the event that published it. */
  async tree(): Promise<RootTree | null> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.tree;
    const root = (await this.contract.getFunction('roots').staticCall(this.attester, 0)) as string;
    let tree: RootTree | null = null;
    if (!/^0x0{64}$/.test(root)) {
      const logs = await this.contract.queryFilter(this.contract.filters.RootPublished!(this.attester, root), this.fromBlock, 'latest');
      // args[2] is `entries`; by name it would collide with Array.prototype.entries
      const log = logs.at(-1) as { args?: unknown[] } | undefined;
      if (log?.args) {
        tree = new RootTree(RootTree.unpack(log.args[2] as string));
        if (tree.root !== root.toLowerCase()) tree = null; // never serve proofs for a tree that doesn't match
      }
    }
    this.cache = { at: Date.now(), tree, root };
    return tree;
  }

  async entry(codeHash: string): Promise<{ entry: RootEntry; proof: string[]; root: string } | null> {
    const tree = await this.tree();
    const entry = tree?.find(codeHash);
    if (!tree || !entry) return null;
    return { entry, proof: tree.proof(entry)!, root: tree.root };
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
          if (hit) return { level: LEVEL_NAME[hit.entry.level], sourceDigest: hit.entry.sourceDigest, via: 'roots', root: hit.root, proof: hit.proof };
        }
      }
      return { level: 'none', sourceDigest: '0x' + '00'.repeat(32), via: 'registry' };
    },
  };
}
