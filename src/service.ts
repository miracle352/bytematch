// Ties verification, storage and attestation together. The HTTP layer and the
// Etherscan-compatible layer both call into this.

import { randomUUID } from 'node:crypto';
import { keccak256 } from 'ethers';
import type { Chain } from './chain.js';
import type { Attester } from './attest.js';
import { bundleDigest, makeBundle } from './bundle.js';
import type { ContractRecord, Store } from './store.js';
import { strip0x } from './bytecode.js';
import { inputFromMetadata, verify, verifyAuto, VerifyError, type Verification } from './verify.js';
import type { StandardJsonInput } from './compiler.js';

export type Submission =
  | { kind: 'standard-json'; address: string; input: StandardJsonInput; contract?: string; compilerVersion?: string }
  | { kind: 'metadata'; address: string; metadata: string; files: Record<string, string> }
  | { kind: 'files'; address: string; files: Record<string, string>; contract?: string; compilerVersion?: string };

export interface Lookup {
  status: 'verified' | 'same-code' | 'unverified' | 'not-a-contract';
  address: string;
  codeHash: string | null;
  record: ContractRecord | null; // for same-code, the record of the contract it shares code with
}

export class Sourcebound {
  constructor(
    readonly chain: Chain,
    readonly store: Store,
    readonly attester: Attester | null,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async submit(s: Submission): Promise<ContractRecord> {
    const address = normaliseAddress(s.address);
    let v: Verification;
    if (s.kind === 'standard-json') {
      v = await verify(this.chain, { address, input: s.input, contract: s.contract, compilerVersion: s.compilerVersion });
    } else if (s.kind === 'metadata') {
      const { input, contract, compilerVersion } = inputFromMetadata(s.metadata, s.files);
      v = await verify(this.chain, { address, input, contract, compilerVersion });
    } else {
      const sources = Object.fromEntries(Object.entries(s.files).map(([p, content]) => [p, { content }]));
      v = await verifyAuto(this.chain, { address, sources, contract: s.contract, compilerVersion: s.compilerVersion });
    }
    const record = toRecord(v);
    const saved = this.store.saveContract(record);
    const current = saved ? record : this.store.getContract(address)!;
    if (saved) this.attestInBackground(current);
    return current;
  }

  private attestInBackground(r: ContractRecord): void {
    if (!this.attester) return;
    this.attester
      .attest(r.address, r.digest, r.level)
      .then((tx) => {
        if (tx) {
          this.store.setAttestation(r.address, tx);
          this.log(`attested ${r.address} (${r.level}) in ${tx}`);
        }
      })
      .catch((e: Error) => this.log(`attestation for ${r.address} failed: ${e.message}`));
  }

  /** Verified directly, or sharing runtime code with a contract that is. */
  async lookup(rawAddress: string): Promise<Lookup> {
    const address = normaliseAddress(rawAddress);
    const code = strip0x(await this.chain.getCode(address));
    if (!code) return { status: 'not-a-contract', address, codeHash: null, record: null };
    const codeHash = keccak256('0x' + code);
    const own = this.store.getContract(address);
    if (own && own.codeHash === codeHash) return { status: 'verified', address, codeHash, record: own };
    const twin = this.store.findByCodeHash(codeHash);
    if (twin) return { status: 'same-code', address, codeHash, record: twin };
    return { status: 'unverified', address, codeHash, record: null };
  }

  /** Etherscan-style async flow: returns a job id immediately, verifies in the background. */
  submitJob(s: Submission): string {
    const id = randomUUID().replace(/-/g, '');
    this.store.createJob(id, s.address.toLowerCase());
    this.submit(s)
      .then((r) => this.store.finishJob(id, 'pass', `Pass - Verified (${r.level} match)`))
      .catch((e: Error) => this.store.finishJob(id, 'fail', `Fail - Unable to verify. ${describeError(e)}`));
    return id;
  }
}

export function describeError(e: unknown): string {
  if (e instanceof VerifyError) {
    const details = Array.isArray(e.details) ? `\n${(e.details as string[]).join('\n')}` : '';
    return e.message + details;
  }
  return e instanceof Error ? e.message : String(e);
}

export function normaliseAddress(a: string): string {
  const s = a.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(s)) throw new VerifyError('bad_input', `${a} is not a 0x-prefixed 20-byte address`);
  return s;
}

function toRecord(v: Verification): ContractRecord {
  const bundle = makeBundle(v.compilerVersion, `${v.contractPath}:${v.contractName}`, v.input);
  const s = v.input.settings ?? {};
  return {
    address: v.address,
    codeHash: v.codeHash,
    level: v.level,
    contractPath: v.contractPath,
    contractName: v.contractName,
    compilerVersion: v.compilerVersion,
    evmVersion: (s.evmVersion as string | undefined) ?? null,
    optimizer: s.optimizer ? { enabled: !!s.optimizer.enabled, runs: s.optimizer.runs ?? 200 } : null,
    viaIR: !!s.viaIR,
    abi: v.abi,
    constructorArgs: v.constructorArgs,
    creationTx: v.creation?.txHash ?? null,
    deployer: v.creation?.deployer ?? null,
    deployBlock: v.creation?.blockNumber ?? null,
    libraries: v.libraries,
    digest: bundleDigest(bundle),
    bundle,
    verifiedAt: new Date().toISOString(),
    attestationTx: null,
  };
}
