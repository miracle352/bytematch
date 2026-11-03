import { resolve } from 'node:path';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing environment variable ${name}`);
}

export const config = {
  rpcUrl: env('RPC_URL', 'https://test-evm-rpc-v3.portaldot.dev'),
  // Substrate JSON-RPC over HTTP; used to list every contract account.
  substrateUrl: env('SUBSTRATE_RPC_URL', 'https://test-node-v3.portaldot.dev'),
  chainId: Number(env('CHAIN_ID', '420420777')),
  dataDir: resolve(env('DATA_DIR', process.env.VERCEL ? '/tmp/bytematch' : 'data')),
  port: Number(env('PORT', '8787')),
  // Optional. Without both, verification still works; results just aren't attested on chain.
  registryAddress: process.env.REGISTRY_ADDRESS || '',
  attesterKey: process.env.ATTESTER_KEY || '',
  // SourceRoots: every verification as one Merkle root. Empty until deployed.
  rootsAddress: process.env.ROOTS_ADDRESS ?? '0x0f9691a6aae5d9b5ed7190551049ced18b8ed086',
  rootsFromBlock: Number(process.env.ROOTS_FROM_BLOCK ?? 306369),
  // Whose attestations to show when running read-only (no ATTESTER_KEY).
  attesterAddress: process.env.ATTESTER_ADDRESS || '0x8d375990766be8a0d1e1a93e6f9fa33ac2023ff3',
  solcBinBase: env('SOLC_BIN_BASE', 'https://binaries.soliditylang.org/bin'),
};
