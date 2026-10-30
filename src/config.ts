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
  solcBinBase: env('SOLC_BIN_BASE', 'https://binaries.soliditylang.org/bin'),
};
