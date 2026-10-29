// The verification bundle: everything needed to reproduce a verification, and the digest
// that gets attested on chain. Anyone holding the bundle can recompile it and check the
// result against any contract with the attested code hash; no trust in this service needed.

import { keccak256, toUtf8Bytes } from 'ethers';
import type { StandardJsonInput } from './compiler.js';

export interface Bundle {
  schema: 'sourcebound/bundle@1';
  compiler: string; // solc long version
  contract: string; // "path:Name"
  input: StandardJsonInput;
}

/** JSON with object keys sorted at every level, so the digest doesn't depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function makeBundle(compiler: string, contract: string, input: StandardJsonInput): Bundle {
  // Output selection never affects bytecode; leave it out so equivalent inputs digest equally.
  const { outputSelection: _ignored, ...settings } = input.settings ?? {};
  return { schema: 'sourcebound/bundle@1', compiler, contract, input: { ...input, settings } };
}

export function bundleDigest(bundle: Bundle): string {
  return keccak256(toUtf8Bytes(canonicalJson(bundle)));
}
