import { FunctionFragment, Interface, keccak256 } from 'ethers';
import type { Chain, Creation } from './chain.js';
import {
  decodeTrailingAuxdata,
  isPolkaVm,
  matchCreation,
  matchRuntime,
  strip0x,
  type Auxdata,
  type MatchLevel,
} from './bytecode.js';
import {
  compile,
  compileErrors,
  defaultEvmVersion,
  resolveVersion,
  type CompiledContract,
  type StandardJsonInput,
} from './compiler.js';

export type ErrorCode = 'not_contract' | 'polkavm' | 'bad_input' | 'compile_error' | 'version_mismatch' | 'no_match';

export class VerifyError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
  }
}

export interface VerifyRequest {
  address: string;
  input: StandardJsonInput;
  /** "path/File.sol:Name" or just "Name". Omit to try every contract in the output. */
  contract?: string;
  /** Omit to use the version recorded in the deployed bytecode. */
  compilerVersion?: string;
}

export interface Verification {
  address: string;
  codeHash: string;
  level: MatchLevel;
  contractPath: string;
  contractName: string;
  compilerVersion: string; // long form, e.g. 0.8.28+commit.7893614a
  input: StandardJsonInput;
  abi: unknown[];
  metadata: string;
  libraries: Record<string, string>;
  immutables: Record<string, string>;
  creation: Creation | null;
  creationLevel: MatchLevel | null;
  constructorArgs: string | null; // 0x-prefixed ABI encoding, null if unknown
  auxdata: Auxdata | null;
}

interface DeployedInfo {
  code: string; // no 0x
  codeHash: string;
  auxdata: Auxdata | null;
}

async function readDeployed(chain: Chain, address: string): Promise<DeployedInfo> {
  const raw = await chain.getCode(address);
  const code = strip0x(raw);
  if (!code) throw new VerifyError('not_contract', `${address} has no code on this chain`);
  if (isPolkaVm(code)) {
    throw new VerifyError(
      'polkavm',
      `${address} runs PolkaVM code (built with resolc). Bytematch currently verifies EVM bytecode, which is what nearly every contract on Portaldot V3 uses.`,
    );
  }
  return { code, codeHash: keccak256('0x' + code), auxdata: decodeTrailingAuxdata(code) };
}

function sameRelease(a: string, b: string): boolean {
  return a.replace(/^v/, '').split('+')[0] === b.replace(/^v/, '').split('+')[0];
}

function pickCandidates(out: Record<string, Record<string, CompiledContract>>, wanted?: string) {
  const all = Object.entries(out).flatMap(([path, byName]) =>
    Object.entries(byName).map(([name, c]) => ({ path, name, c })),
  );
  const withCode = all.filter((x) => x.c.evm?.deployedBytecode?.object);
  if (!wanted) return withCode;
  const idx = wanted.lastIndexOf(':');
  const [path, name] = idx >= 0 ? [wanted.slice(0, idx), wanted.slice(idx + 1)] : [undefined, wanted];
  const hits = withCode.filter((x) => x.name === name && (path === undefined || x.path === path));
  if (!hits.length) {
    const known = withCode.map((x) => `${x.path}:${x.name}`).join(', ');
    throw new VerifyError('bad_input', `contract ${wanted} not found in compiler output (has: ${known || 'none'})`);
  }
  return hits;
}

async function attempt(
  chain: Chain,
  deployed: DeployedInfo,
  address: string,
  version: string,
  input: StandardJsonInput,
  contract?: string,
): Promise<Verification | null> {
  const out = await compile(version, input);
  const errors = compileErrors(out);
  if (errors.length) throw new VerifyError('compile_error', 'the sources did not compile', errors);

  let best: { cand: ReturnType<typeof pickCandidates>[number]; m: NonNullable<ReturnType<typeof matchRuntime>> } | null = null;
  for (const cand of pickCandidates(out.contracts ?? {}, contract)) {
    const d = cand.c.evm.deployedBytecode;
    const m = matchRuntime(d.object, deployed.code, d.linkReferences, d.immutableReferences);
    if (m && (!best || (m.level === 'exact' && best.m.level !== 'exact'))) best = { cand, m };
    if (best?.m.level === 'exact') break;
  }
  if (!best) return null;

  const creation = await chain.findCreation(address);
  let creationLevel: MatchLevel | null = null;
  let constructorArgs: string | null = null;
  if (creation?.input) {
    const cm = matchCreation(best.cand.c.evm.bytecode.object, strip0x(creation.input), best.cand.c.evm.bytecode.linkReferences);
    if (cm) {
      creationLevel = cm.level;
      constructorArgs = '0x' + cm.constructorArgs;
    }
  }

  return {
    address: address.toLowerCase(),
    codeHash: deployed.codeHash,
    level: best.m.level,
    contractPath: best.cand.path,
    contractName: best.cand.name,
    compilerVersion: await resolveVersion(version),
    input,
    abi: best.cand.c.abi,
    metadata: best.cand.c.metadata,
    libraries: best.m.libraries,
    immutables: best.m.immutables,
    creation,
    creationLevel,
    constructorArgs,
    auxdata: deployed.auxdata,
  };
}

function resolveRequestedVersion(deployed: DeployedInfo, requested?: string): string {
  const onChain = deployed.auxdata?.solc;
  if (requested && onChain && !sameRelease(requested, onChain)) {
    throw new VerifyError(
      'version_mismatch',
      `the deployed code was built with solc ${onChain}, but ${requested} was selected`,
    );
  }
  const version = requested ?? onChain;
  if (!version) {
    throw new VerifyError('bad_input', 'the deployed code does not record its compiler version; pass compilerVersion');
  }
  return version;
}

/** Verify with exactly the settings given (standard JSON input). */
export async function verify(chain: Chain, req: VerifyRequest): Promise<Verification> {
  const deployed = await readDeployed(chain, req.address);
  const version = resolveRequestedVersion(deployed, req.compilerVersion);
  const result = await attempt(chain, deployed, req.address, version, req.input, req.contract);
  if (!result) {
    throw new VerifyError(
      'no_match',
      'compiled fine, but no contract in the output matches the deployed code. Check the optimizer, viaIR, evmVersion and libraries settings.',
    );
  }
  return result;
}

export interface AutoRequest {
  address: string;
  sources: Record<string, { content: string }>;
  contract?: string;
  compilerVersion?: string;
}

/**
 * Verify from source files alone: try the settings people actually deploy with until one
 * reproduces the deployed code. The deployed auxdata tells us the compiler version and
 * the metadata hash type, which prunes most of the search.
 */
export async function verifyAuto(chain: Chain, req: AutoRequest, maxAttempts = 48): Promise<Verification & { tried: number }> {
  const deployed = await readDeployed(chain, req.address);
  const version = resolveRequestedVersion(deployed, req.compilerVersion);
  const aux = deployed.auxdata;
  const bytecodeHash: 'ipfs' | 'bzzr1' | 'none' = aux?.ipfs ? 'ipfs' : aux?.bzzr ? 'bzzr1' : 'none';

  const evms = [...new Set([defaultEvmVersion(version), 'paris', 'shanghai', 'cancun', 'london', 'prague'])];
  const optimizers = [
    { enabled: false, runs: 200 },
    { enabled: true, runs: 200 },
    { enabled: true, runs: 1 },
    { enabled: true, runs: 1000 },
    { enabled: true, runs: 10000 },
    { enabled: true, runs: 999999 },
  ];

  // Settings change code layout but never function selectors. If no candidate's selectors
  // all appear in the deployed code, these sources can't match under any settings.
  const probe = await compile(version, {
    language: 'Solidity',
    sources: req.sources,
    settings: { evmVersion: defaultEvmVersion(version), metadata: { bytecodeHash } },
  });
  const probeErrors = compileErrors(probe);
  if (probeErrors.length) throw new VerifyError('compile_error', 'the sources did not compile', probeErrors);
  const plausible = pickCandidates(probe.contracts ?? {}, req.contract).filter((x) =>
    // The optimizer pushes a selector like 0x00ab12cd as PUSH3 ab12cd, so drop leading zero bytes.
    selectorsOf(x.c.abi).every((sel) => deployed.code.includes(sel.replace(/^(00)+/, ''))),
  );
  if (!plausible.length) {
    throw new VerifyError(
      'no_match',
      'none of the submitted contracts has the functions found in the deployed code, so no compiler settings can make them match',
    );
  }
  const target = req.contract ?? (plausible.length === 1 ? `${plausible[0]!.path}:${plausible[0]!.name}` : undefined);

  let tried = 0;
  for (const viaIR of [false, true]) {
    for (const evmVersion of evms) {
      for (const optimizer of optimizers) {
        if (tried >= maxAttempts) break;
        tried++;
        const input: StandardJsonInput = {
          language: 'Solidity',
          sources: req.sources,
          settings: { optimizer, evmVersion, viaIR, metadata: { bytecodeHash } },
        };
        let result: Verification | null;
        try {
          result = await attempt(chain, deployed, req.address, version, input, target);
        } catch (e) {
          // A bad evmVersion for this compiler is just a skipped candidate; real source
          // errors surface on the first attempt.
          if (e instanceof VerifyError && e.code === 'compile_error' && tried > 1) continue;
          throw e;
        }
        // A partial match already pins the settings that reproduce the code. An exact
        // match additionally needs the original file paths and text, which no amount of
        // further searching supplies, so stop at the first hit of either kind.
        if (result) return { ...result, tried };
      }
    }
  }
  throw new VerifyError(
    'no_match',
    `tried ${tried} common compiler settings and none reproduced the deployed code. Submit your standard JSON input instead.`,
  );
}

/** 4-byte selectors (hex, no 0x) of the external functions in an ABI. */
function selectorsOf(abi: unknown[]): string[] {
  const fns = (abi as Array<{ type: string }>).filter((f) => f.type === 'function');
  if (!fns.length) return [];
  return new Interface(abi as never).fragments
    .filter((f): f is FunctionFragment => f.type === 'function')
    .map((f) => f.selector.slice(2));
}

/** Turn a solc metadata.json (as Remix and Hardhat emit) into a standard JSON input. */
export function inputFromMetadata(
  metadataJson: string,
  files: Record<string, string>,
): { input: StandardJsonInput; contract: string; compilerVersion: string } {
  const meta = JSON.parse(metadataJson) as {
    compiler: { version: string };
    language: 'Solidity';
    settings: Record<string, unknown> & { compilationTarget: Record<string, string> };
    sources: Record<string, { content?: string; keccak256: string }>;
  };
  const sources: Record<string, { content: string }> = {};
  for (const [path, s] of Object.entries(meta.sources)) {
    const content = s.content ?? files[path] ?? files[path.split('/').pop()!];
    if (content === undefined) throw new VerifyError('bad_input', `metadata lists ${path}, but that file was not provided`);
    if (keccak256(Buffer.from(content, 'utf8')) !== s.keccak256) {
      throw new VerifyError('bad_input', `${path} does not match the hash recorded in metadata.json`);
    }
    sources[path] = { content };
  }
  const { compilationTarget, ...settings } = meta.settings;
  const [path, name] = Object.entries(compilationTarget)[0] ?? [];
  if (!path || !name) throw new VerifyError('bad_input', 'metadata.json has no compilationTarget');
  return {
    input: { language: meta.language, sources, settings },
    contract: `${path}:${name}`,
    compilerVersion: meta.compiler.version,
  };
}
