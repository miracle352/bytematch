// The off-chain half of SourceRoots: one Merkle tree over every verified code, its
// proofs, and the packed entry list that goes into the RootPublished event.
//
// Leaf  = keccak256(keccak256(abi.encode(codeHash, level, sourceDigest)))
// Nodes = keccak256(abi.encode(min(a, b), max(a, b)))   (sorted pairs, OpenZeppelin style)

import { AbiCoder, concat, getBytes, hexlify, keccak256, toBeHex } from 'ethers';

export interface RootEntry {
  codeHash: string;
  level: 1 | 2; // 1 = partial, 2 = exact
  sourceDigest: string;
}

const coder = AbiCoder.defaultAbiCoder();

export const leafOf = (e: RootEntry) =>
  keccak256(keccak256(coder.encode(['bytes32', 'uint8', 'bytes32'], [e.codeHash, e.level, e.sourceDigest])));

const pair = (a: string, b: string) => (a < b ? keccak256(concat([a, b])) : keccak256(concat([b, a])));

export class RootTree {
  readonly entries: RootEntry[];
  private readonly layers: string[][];

  /** One entry per code hash (the best level wins), in a canonical order. */
  constructor(entries: RootEntry[]) {
    const best = new Map<string, RootEntry>();
    for (const e of entries) {
      const k = e.codeHash.toLowerCase();
      const cur = best.get(k);
      if (!cur || e.level > cur.level) best.set(k, { codeHash: k, level: e.level, sourceDigest: e.sourceDigest.toLowerCase() });
    }
    this.entries = [...best.values()].sort((a, b) => (a.codeHash < b.codeHash ? -1 : 1));
    const leaves = this.entries.map(leafOf).sort();
    this.layers = [leaves];
    while (this.layers.at(-1)!.length > 1) {
      const prev = this.layers.at(-1)!;
      const next: string[] = [];
      for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? pair(prev[i]!, prev[i + 1]!) : prev[i]!);
      this.layers.push(next);
    }
  }

  get root(): string {
    return this.layers.at(-1)![0] ?? '0x' + '00'.repeat(32);
  }

  /** Sibling hashes from the leaf up, or null if the entry is not in the tree. */
  proof(e: RootEntry): string[] | null {
    let i = this.layers[0]!.indexOf(leafOf({ ...e, codeHash: e.codeHash.toLowerCase(), sourceDigest: e.sourceDigest.toLowerCase() }));
    if (i < 0) return null;
    const out: string[] = [];
    for (const layer of this.layers.slice(0, -1)) {
      const sib = i ^ 1;
      if (sib < layer.length) out.push(layer[sib]!);
      i >>= 1;
    }
    return out;
  }

  find(codeHash: string): RootEntry | null {
    return this.entries.find((e) => e.codeHash === codeHash.toLowerCase()) ?? null;
  }

  /** codeHash (32) | level (1) | sourceDigest (32), per entry. */
  packed(): string {
    return hexlify(concat(this.entries.flatMap((e) => [e.codeHash, toBeHex(e.level, 1), e.sourceDigest])));
  }

  static unpack(data: string): RootEntry[] {
    const b = getBytes(data);
    const out: RootEntry[] = [];
    for (let o = 0; o + 65 <= b.length; o += 65) {
      out.push({ codeHash: hexlify(b.slice(o, o + 32)), level: b[o + 32] as 1 | 2, sourceDigest: hexlify(b.slice(o + 33, o + 65)) });
    }
    return out;
  }
}

export const verifyProof = (e: RootEntry, proof: string[], root: string) =>
  proof.reduce((node, p) => pair(node, p), leafOf(e)) === root.toLowerCase();
