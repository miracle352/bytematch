import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { AbiCoder } from 'ethers';
import {
  decodeTrailingAuxdata,
  findAuxdata,
  isPolkaVm,
  matchCreation,
  matchRuntime,
  type Range,
} from '../src/bytecode.js';

// The solc package bundles 0.8.28, so these tests run offline.
const solc = createRequire(import.meta.url)('solc') as { compile(s: string): string };

const SOURCE = (comment: string, body = 'return L.f(x) + a;') => `
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
// ${comment}
library L { function f(uint256 x) external pure returns (uint256) { return x + 1; } }
contract Child { uint256 public v; constructor(uint256 x) { v = x; } }
contract C {
  uint256 immutable a;
  constructor(uint256 x) { a = x; }
  function g(uint256 x) external view returns (uint256) { ${body} }
  function make() external returns (address) { return address(new Child(1)); }
}`;

interface Out {
  object: string;
  linkReferences: Record<string, Record<string, Range[]>>;
  immutableReferences?: Record<string, Range[]>;
}

function build(source: string) {
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources: { 'C.sol': { content: source } },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          outputSelection: { '*': { '*': ['evm.bytecode', 'evm.deployedBytecode'] } },
        },
      }),
    ),
  );
  const c = out.contracts['C.sol'].C.evm;
  return { creation: c.bytecode as Out, runtime: c.deployedBytecode as Out };
}

const LIB = '1111111111111111111111111111111111111111';
const IMM = '00000000000000000000000000000000000000000000000000000000000004d2'; // 1234

function link(o: Out): string {
  let code = o.object;
  for (const libs of Object.values(o.linkReferences)) {
    for (const ranges of Object.values(libs)) {
      for (const r of ranges) code = code.slice(0, r.start * 2) + LIB + code.slice((r.start + r.length) * 2);
    }
  }
  return code;
}

function deploy(o: Out): string {
  let code = link(o);
  for (const ranges of Object.values(o.immutableReferences ?? {})) {
    for (const r of ranges) code = code.slice(0, r.start * 2) + IMM + code.slice((r.start + r.length) * 2);
  }
  return code;
}

const original = build(SOURCE('v1'));
const deployedRuntime = deploy(original.runtime);

describe('auxdata', () => {
  it('decodes the compiler version and IPFS hash', () => {
    const aux = decodeTrailingAuxdata(deployedRuntime);
    expect(aux?.solc).toBe('0.8.28');
    expect(aux?.ipfs).toMatch(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
  });

  it('finds the embedded child metadata as well as the contract’s own', () => {
    const ranges = findAuxdata(deployedRuntime);
    expect(ranges).toHaveLength(2);
    expect(ranges.at(-1)!.start + ranges.at(-1)!.length).toBe(deployedRuntime.length / 2);
  });

  it('returns null for code without auxdata', () => {
    expect(decodeTrailingAuxdata('6080604052')).toBeNull();
  });
});

describe('runtime matching', () => {
  it('is exact for the same source, filling libraries and immutables from chain', () => {
    const m = matchRuntime(original.runtime.object, deployedRuntime, original.runtime.linkReferences, original.runtime.immutableReferences);
    expect(m?.level).toBe('exact');
    expect(Object.values(m!.libraries)).toEqual(['0x' + LIB]);
    expect(Object.values(m!.immutables)).toEqual(['0x' + IMM]);
  });

  it('is partial when only a comment changed', () => {
    const edited = build(SOURCE('v2, comment only')).runtime;
    expect(edited.object).not.toBe(original.runtime.object);
    const m = matchRuntime(edited.object, deployedRuntime, edited.linkReferences, edited.immutableReferences);
    expect(m?.level).toBe('partial');
  });

  it('fails when the logic changed', () => {
    const changed = build(SOURCE('v1', 'return L.f(x) + a + 1;')).runtime;
    expect(matchRuntime(changed.object, deployedRuntime, changed.linkReferences, changed.immutableReferences)).toBeNull();
  });

  it('does not let a mismatch hide inside the masked metadata of a different-length build', () => {
    expect(matchRuntime(original.runtime.object, deployedRuntime + '00')).toBeNull();
  });
});

describe('creation matching', () => {
  it('splits the deploy input into init code and constructor arguments', () => {
    const args = AbiCoder.defaultAbiCoder().encode(['uint256'], [1234]).slice(2);
    const m = matchCreation(original.creation.object, link(original.creation) + args, original.creation.linkReferences);
    expect(m?.level).toBe('exact');
    expect(m?.constructorArgs).toBe(args);
  });

  it('rejects input that is shorter than the init code', () => {
    expect(matchCreation(original.creation.object, '6080')).toBeNull();
  });
});

describe('code kind', () => {
  it('recognises PolkaVM blobs', () => {
    expect(isPolkaVm('50564d0000')).toBe(true);
    expect(isPolkaVm(deployedRuntime)).toBe(false);
  });
});
