// Client for the Bytematch API (same origin in production, proxied in development).

export type MatchLevel = 'exact' | 'partial';
export type LookupStatus = 'verified' | 'same-code' | 'unverified' | 'not-a-contract';
export type CoverageStatus = 'verified' | 'same-code' | 'unverified';

export interface Verification {
  address: string;
  codeHash: string;
  match: MatchLevel;
  contract: { path: string; name: string };
  compiler: { version: string; evmVersion: string | null; optimizer: { enabled: boolean; runs: number } | null; viaIR: boolean };
  deployment: {
    tx: string | null;
    deployer: string | null;
    block: number | null;
    constructorArgs: string | null;
    constructorArgsDecoded: Array<{ name: string; type: string; value: unknown }> | null;
  };
  libraries: Record<string, string>;
  digest: string;
  attestationTx: string | null;
  verifiedAt: string;
}

export interface ContractLookup {
  status: LookupStatus;
  address: string;
  codeHash: string | null;
  verification: Verification | null;
  abi: AbiItem[] | null;
  onChain: { level: 'none' | 'partial' | 'exact'; sourceDigest: string } | null;
}

export interface AbiItem {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: Array<{ name: string; type: string }>;
  outputs?: Array<{ name: string; type: string }>;
}

export interface NetworkRow {
  address: string;
  codeHash: string;
  kind: 'evm' | 'pvm';
  size: number;
  status: CoverageStatus;
  name: string | null;
  match: MatchLevel | null;
  verifiedAs: string | null;
}

export interface Network {
  updatedAt: string;
  totals: { contracts: number; evm: number; pvm: number; uniqueCode: number; verified: number; sameCode: number; unverified: number };
  contracts: NetworkRow[];
}

export interface Health {
  ok: boolean;
  chainId: number | null;
  block: number | null;
  registry: string | null;
  attester: string | null;
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public details: unknown = null, public status = 0) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('offline', 'Bytematch’s API could not be reached. Check your connection and try again.');
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('bad_response', `The API answered with something that isn’t JSON (HTTP ${res.status}).`, null, res.status);
  }
  if (!res.ok) {
    const e = body?.error ?? {};
    throw new ApiError(e.code ?? 'http', e.message ?? `Request failed with HTTP ${res.status}.`, e.details ?? null, res.status);
  }
  return body as T;
}

export const api = {
  health: () => request<Health>('/health'),
  contract: (address: string) => request<ContractLookup>(`/v1/contracts/${address}`),
  files: (address: string) => request<Record<string, string>>(`/v1/contracts/${address}/files`),
  network: () => request<Network>('/v1/network'),
  recent: (limit = 12) => request<{ items: Verification[] }>(`/v1/contracts?limit=${limit}`),
  verify: (body: unknown) =>
    request<Verification>('/v1/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
};

export const REGISTRY_ADDRESS = '0x6aea3b20e67e8b5b660d0d8eb917c790e190a203';
