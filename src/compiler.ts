// Fetches and runs official solc builds (soljson) from binaries.soliditylang.org.
// Builds are cached on disk; a few stay loaded in memory since each is ~8 MB of wasm.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const require = createRequire(import.meta.url);
const wrapper = require('solc/wrapper') as (soljson: unknown) => SolcInstance;

interface SolcInstance {
  version(): string;
  compile(input: string, opts?: { import?: (path: string) => { contents?: string; error?: string } }): string;
}

export interface StandardJsonInput {
  language: 'Solidity' | 'Yul';
  sources: Record<string, { content: string }>;
  settings?: Record<string, unknown> & {
    optimizer?: { enabled?: boolean; runs?: number; details?: unknown };
    evmVersion?: string;
    viaIR?: boolean;
    libraries?: Record<string, Record<string, string>>;
    metadata?: { bytecodeHash?: 'ipfs' | 'bzzr1' | 'none'; useLiteralContent?: boolean; appendCBOR?: boolean };
    remappings?: string[];
    outputSelection?: unknown;
  };
}

export interface CompiledContract {
  abi: unknown[];
  metadata: string;
  evm: {
    bytecode: { object: string; linkReferences?: Record<string, Record<string, Array<{ start: number; length: number }>>> };
    deployedBytecode: {
      object: string;
      linkReferences?: Record<string, Record<string, Array<{ start: number; length: number }>>>;
      immutableReferences?: Record<string, Array<{ start: number; length: number }>>;
    };
  };
}

export interface CompilerOutput {
  errors?: Array<{ severity: string; formattedMessage?: string; message: string }>;
  contracts?: Record<string, Record<string, CompiledContract>>;
}

interface BuildList {
  builds: Array<{ path: string; version: string; longVersion: string; prerelease?: string }>;
  releases: Record<string, string>;
  latestRelease: string;
}

const OUTPUTS = [
  'abi',
  'metadata',
  'evm.bytecode.object',
  'evm.bytecode.linkReferences',
  'evm.deployedBytecode.object',
  'evm.deployedBytecode.linkReferences',
  'evm.deployedBytecode.immutableReferences',
];

const solcDir = () => {
  const d = join(config.dataDir, 'solc');
  mkdirSync(d, { recursive: true });
  return d;
};

let buildList: BuildList | null = null;

async function getBuildList(): Promise<BuildList> {
  if (buildList) return buildList;
  const cached = join(solcDir(), 'list.json');
  try {
    const res = await fetch(`${config.solcBinBase}/list.json`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    writeFileSync(cached, text);
    buildList = JSON.parse(text) as BuildList;
  } catch (e) {
    if (!existsSync(cached)) throw new Error(`cannot fetch solc build list: ${(e as Error).message}`);
    buildList = JSON.parse(readFileSync(cached, 'utf8')) as BuildList;
  }
  return buildList;
}

/** Accepts "0.8.28", "v0.8.28+commit.7893614a" or "0.8.28+commit.7893614a". Returns the long form. */
export async function resolveVersion(v: string): Promise<string> {
  const list = await getBuildList();
  const want = v.trim().replace(/^v/, '');
  if (want === 'latest') return list.builds.find((b) => b.version === list.latestRelease)!.longVersion;
  const hit =
    list.builds.find((b) => b.longVersion === want) ??
    (list.releases[want] ? list.builds.find((b) => b.path === list.releases[want]) : undefined);
  if (!hit) throw new Error(`unknown solc version ${v}`);
  return hit.longVersion;
}

const loaded = new Map<string, SolcInstance>();
const MAX_LOADED = 3;

async function load(longVersion: string): Promise<SolcInstance> {
  const hit = loaded.get(longVersion);
  if (hit) {
    loaded.delete(longVersion);
    loaded.set(longVersion, hit);
    return hit;
  }
  const file = join(solcDir(), `soljson-v${longVersion}.js`);
  if (!existsSync(file)) {
    const res = await fetch(`${config.solcBinBase}/soljson-v${longVersion}.js`, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`cannot download solc ${longVersion}: HTTP ${res.status}`);
    const tmp = `${file}.part`;
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    renameSync(tmp, file);
  }
  const solc = wrapper(require(file));
  loaded.set(longVersion, solc);
  while (loaded.size > MAX_LOADED) loaded.delete(loaded.keys().next().value!);
  return solc;
}

/**
 * Compile a standard JSON input. Output selection is replaced (it does not affect
 * bytecode) and imports are never read from disk: every file must be in `sources`.
 */
export async function compile(version: string, input: StandardJsonInput): Promise<CompilerOutput> {
  const longVersion = await resolveVersion(version);
  const solc = await load(longVersion);
  const prepared: StandardJsonInput = {
    ...input,
    settings: { ...input.settings, outputSelection: { '*': { '*': OUTPUTS } } },
  };
  const raw = solc.compile(JSON.stringify(prepared), {
    import: (path) => ({ error: `${path} was imported but not included in the submitted sources` }),
  });
  return JSON.parse(raw) as CompilerOutput;
}

export function compileErrors(out: CompilerOutput): string[] {
  return (out.errors ?? []).filter((e) => e.severity === 'error').map((e) => e.formattedMessage ?? e.message);
}

/** The EVM version solc uses when none is given, which changed across releases. */
export function defaultEvmVersion(version: string): string {
  const [, minor = 0, patch = 0] = version.replace(/^v/, '').split(/[.+]/).map(Number);
  if (minor < 8) return 'istanbul';
  if (patch >= 30) return 'prague';
  if (patch >= 25) return 'cancun';
  if (patch >= 20) return 'shanghai';
  if (patch >= 18) return 'paris';
  if (patch >= 7) return 'london';
  return 'berlin';
}
