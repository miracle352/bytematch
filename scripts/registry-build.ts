// The one place that defines how SourceRegistry is built, so the deploy script, the
// tests and self-verification all compile it identically.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, compileErrors, type StandardJsonInput } from '../src/compiler.js';

export const REGISTRY_SOURCE_KEY = 'contracts/SourceRegistry.sol';
export const REGISTRY_COMPILER = '0.8.28';

export function registryInput(): StandardJsonInput {
  const path = fileURLToPath(new URL(`../${REGISTRY_SOURCE_KEY}`, import.meta.url));
  return {
    language: 'Solidity',
    sources: { [REGISTRY_SOURCE_KEY]: { content: readFileSync(path, 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      metadata: { bytecodeHash: 'ipfs' },
    },
  };
}

export async function buildRegistry() {
  const input = registryInput();
  const out = await compile(REGISTRY_COMPILER, input);
  const errors = compileErrors(out);
  if (errors.length) throw new Error(errors.join('\n'));
  const c = out.contracts![REGISTRY_SOURCE_KEY]!.SourceRegistry!;
  return { input, abi: c.abi, bytecode: '0x' + c.evm.bytecode.object, deployedBytecode: '0x' + c.evm.deployedBytecode.object };
}
