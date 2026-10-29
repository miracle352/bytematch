// Writes verification results to SourceRegistry on chain. Transactions are sent one at a
// time from a single key so nonces never collide.

import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import type { MatchLevel } from './bytecode.js';

export const REGISTRY_ABI = [
  'function attest(address sample, bytes32 sourceDigest, uint8 level) returns (bytes32)',
  'function revoke(bytes32 codeHash)',
  'function check(address target, address attester) view returns (uint8 level, bytes32 sourceDigest)',
  'function attestation(address attester, bytes32 codeHash) view returns (tuple(bytes32 sourceDigest, uint8 level, uint64 attestedAt, address sample))',
  'event Attested(address indexed attester, bytes32 indexed codeHash, address indexed sample, bytes32 sourceDigest, uint8 level)',
  'event Revoked(address indexed attester, bytes32 indexed codeHash)',
];

export const LEVEL_CODE: Record<MatchLevel, number> = { partial: 1, exact: 2 };
export const LEVEL_NAME = ['none', 'partial', 'exact'] as const;

export interface OnChainAttestation {
  level: (typeof LEVEL_NAME)[number];
  sourceDigest: string;
}

export class Attester {
  readonly wallet: Wallet;
  readonly registry: Contract;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(rpcUrl: string, chainId: number, registryAddress: string, key: string) {
    const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.wallet = new Wallet(key, provider);
    this.registry = new Contract(registryAddress, REGISTRY_ABI, this.wallet);
  }

  get address(): string {
    return this.wallet.address;
  }

  async read(target: string, attester = this.wallet.address): Promise<OnChainAttestation> {
    const [level, sourceDigest] = (await this.registry.getFunction('check').staticCall(target, attester)) as [bigint, string];
    return { level: LEVEL_NAME[Number(level)] ?? 'none', sourceDigest };
  }

  /** Attest unless an equal-or-better attestation for the same bundle is already there. Returns the tx hash. */
  attest(sample: string, digest: string, level: MatchLevel): Promise<string | null> {
    const run = async () => {
      const current = await this.read(sample);
      if (current.sourceDigest === digest && LEVEL_NAME.indexOf(current.level) >= LEVEL_CODE[level]) return null;
      const tx = await this.registry.getFunction('attest')(sample, digest, LEVEL_CODE[level]);
      const receipt = await tx.wait();
      if (receipt?.status !== 1) throw new Error(`attestation tx ${tx.hash} failed`);
      return tx.hash as string;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
