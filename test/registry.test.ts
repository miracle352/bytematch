// SourceRegistry in a local EVM (cancun, matching the deployed build settings).

import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { Interface, keccak256, getBytes, hexlify } from 'ethers';
import { VM } from '@ethereumjs/vm';
import { Common, Chain as CommonChain, Hardfork } from '@ethereumjs/common';
import { Address, hexToBytes } from '@ethereumjs/util';
import { registryInput, REGISTRY_SOURCE_KEY } from '../scripts/registry-build.js';

const solc = createRequire(import.meta.url)('solc') as { compile(s: string): string };

function compileAll(sources: Record<string, { content: string }>, settings: object) {
  const out = JSON.parse(
    solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { ...settings, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })),
  );
  const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join('\n'));
  return out.contracts;
}

const reg = registryInput();
const registryOut = compileAll(reg.sources, reg.settings!)[REGISTRY_SOURCE_KEY].SourceRegistry;
const targetOut = compileAll(
  { 'T.sol': { content: 'pragma solidity 0.8.28; contract Target { function hi() external pure returns (uint) { return 1; } }' } },
  { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' },
)['T.sol'].Target;

const iface = new Interface(registryOut.abi);
const ALICE = Address.fromString('0x' + 'a1'.repeat(20));
const BOB = Address.fromString('0x' + 'b0'.repeat(20));
const DIGEST = keccak256(new TextEncoder().encode('bundle'));

let vm: VM;
let registry: Address;
let target: Address;
let twin: Address;

async function deploy(bytecode: string): Promise<Address> {
  const r = await vm.evm.runCall({ caller: ALICE, data: hexToBytes('0x' + bytecode), gasLimit: 10_000_000n });
  if (r.execResult.exceptionError) throw new Error(`deploy failed: ${r.execResult.exceptionError.error}`);
  return r.createdAddress!;
}

async function call(from: Address, fn: string, args: unknown[]) {
  const r = await vm.evm.runCall({ caller: from, to: registry, data: getBytes(iface.encodeFunctionData(fn, args)), gasLimit: 1_000_000n });
  const ret = hexlify(r.execResult.returnValue);
  if (r.execResult.exceptionError) {
    const err = iface.parseError(ret);
    return { reverted: err?.name ?? 'unknown', result: null };
  }
  return { reverted: null, result: iface.decodeFunctionResult(fn, ret) };
}

beforeAll(async () => {
  vm = await VM.create({ common: new Common({ chain: CommonChain.Mainnet, hardfork: Hardfork.Cancun }) });
  registry = await deploy(registryOut.evm.bytecode.object);
  target = await deploy(targetOut.evm.bytecode.object);
  twin = await deploy(targetOut.evm.bytecode.object); // same runtime code, different address
});

describe('SourceRegistry', () => {
  it('records an attestation under the target’s code hash', async () => {
    const { reverted, result } = await call(ALICE, 'attest', [target.toString(), DIGEST, 2]);
    expect(reverted).toBeNull();
    const code = await vm.stateManager.getContractCode(target);
    expect(result![0]).toBe(keccak256(code));

    const check = await call(ALICE, 'check', [target.toString(), ALICE.toString()]);
    expect(check.result![0]).toBe(2n);
    expect(check.result![1]).toBe(DIGEST);
  });

  it('covers every contract with the same code', async () => {
    const check = await call(BOB, 'check', [twin.toString(), ALICE.toString()]);
    expect(check.result![0]).toBe(2n);
  });

  it('keeps attesters separate', async () => {
    const check = await call(BOB, 'check', [target.toString(), BOB.toString()]);
    expect(check.result![0]).toBe(0n);
  });

  it('refuses accounts without code', async () => {
    const r = await call(ALICE, 'attest', [BOB.toString(), DIGEST, 2]);
    expect(r.reverted).toBe('NotAContract');
  });

  it('refuses level None', async () => {
    const r = await call(ALICE, 'attest', [target.toString(), DIGEST, 0]);
    expect(r.reverted).toBe('InvalidLevel');
  });

  it('lets an attester revoke only its own attestation', async () => {
    const hash = keccak256(await vm.stateManager.getContractCode(target));
    expect((await call(BOB, 'revoke', [hash])).reverted).toBe('NothingToRevoke');
    expect((await call(ALICE, 'revoke', [hash])).reverted).toBeNull();
    expect((await call(BOB, 'check', [target.toString(), ALICE.toString()])).result![0]).toBe(0n);
    expect((await call(ALICE, 'revoke', [hash])).reverted).toBe('NothingToRevoke');
  });
});
