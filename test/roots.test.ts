// SourceRoots in a local EVM, checked against the off-chain tree that builds its proofs.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Interface, keccak256, getBytes, hexlify } from 'ethers';
import { VM } from '@ethereumjs/vm';
import { Common, Chain as CommonChain, Hardfork } from '@ethereumjs/common';
import { Address, hexToBytes } from '@ethereumjs/util';
import { RootTree, verifyProof, type RootEntry } from '../src/roots.js';

const solc = createRequire(import.meta.url)('solc') as { compile(s: string): string };
const compile = (sources: Record<string, { content: string }>) => {
  const out = JSON.parse(
    solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })),
  );
  const errs = (out.errors ?? []).filter((e: { severity: string }) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e: { formattedMessage: string }) => e.formattedMessage).join('\n'));
  return out.contracts;
};

const rootsOut = compile({ 'contracts/SourceRoots.sol': { content: readFileSync('contracts/SourceRoots.sol', 'utf8') } })['contracts/SourceRoots.sol'].SourceRoots;
const targets = compile({
  'T.sol': { content: 'pragma solidity 0.8.28; contract A { function a() external pure returns (uint) { return 1; } } contract B { function b() external pure returns (uint) { return 2; } }' },
})['T.sol'];
const iface = new Interface(rootsOut.abi);
const ALICE = Address.fromString('0x' + 'a1'.repeat(20));
const BOB = Address.fromString('0x' + 'b0'.repeat(20));
const D = (s: string) => keccak256(new TextEncoder().encode(s));

let vm: VM;
let roots: Address;
let a: Address;
let b: Address;

async function deploy(code: string) {
  const r = await vm.evm.runCall({ caller: ALICE, data: hexToBytes('0x' + code), gasLimit: 10_000_000n });
  if (r.execResult.exceptionError) throw new Error(r.execResult.exceptionError.error);
  return r.createdAddress!;
}
async function call(from: Address, fn: string, args: unknown[]) {
  const r = await vm.evm.runCall({ caller: from, to: roots, data: getBytes(iface.encodeFunctionData(fn, args)), gasLimit: 5_000_000n });
  if (r.execResult.exceptionError) throw new Error(r.execResult.exceptionError.error);
  return { out: iface.decodeFunctionResult(fn, hexlify(r.execResult.returnValue)), logs: r.execResult.logs ?? [] };
}
const codeHash = async (x: Address) => keccak256(await vm.stateManager.getContractCode(x));

beforeAll(async () => {
  vm = await VM.create({ common: new Common({ chain: CommonChain.Mainnet, hardfork: Hardfork.Cancun }) });
  roots = await deploy(rootsOut.evm.bytecode.object);
  a = await deploy(targets.A.evm.bytecode.object);
  b = await deploy(targets.B.evm.bytecode.object);
});

describe('SourceRoots', () => {
  let tree: RootTree;
  let ea: RootEntry;
  let eb: RootEntry;

  beforeAll(async () => {
    ea = { codeHash: await codeHash(a), level: 2, sourceDigest: D('a') };
    eb = { codeHash: await codeHash(b), level: 1, sourceDigest: D('b') };
    const filler = Array.from({ length: 37 }, (_, i) => ({ codeHash: D(`code${i}`), level: 2 as const, sourceDigest: D(`src${i}`) }));
    tree = new RootTree([...filler, ea, eb, { ...eb, level: 1 }]);
  });

  it('builds proofs that verify off chain', () => {
    expect(tree.entries).toHaveLength(39);
    for (const e of tree.entries) expect(verifyProof(e, tree.proof(e)!, tree.root)).toBe(true);
    expect(tree.proof({ ...ea, sourceDigest: D('other') })).toBeNull();
  });

  it('rebuilds the same root from incremental entry lists', () => {
    const first = new RootTree(tree.entries.slice(0, 20));
    const upgrade = { ...eb, level: 2 as const };
    const all = new RootTree([...first.entries, ...tree.entries, upgrade]);
    const have = new Set(first.entries.map((e) => `${e.codeHash}|${e.level}|${e.sourceDigest}`));
    const delta = all.entries.filter((e) => !have.has(`${e.codeHash}|${e.level}|${e.sourceDigest}`));
    expect(delta.length).toBeLessThan(all.entries.length);
    const rebuilt = new RootTree([...RootTree.unpack(first.packed()), ...RootTree.unpack(new RootTree(delta).packed())]);
    expect(rebuilt.root).toBe(all.root);
    expect(rebuilt.find(eb.codeHash)!.level).toBe(2);
  });

  it('round-trips the packed entries', () => {
    expect(RootTree.unpack(tree.packed())).toEqual(tree.entries);
  });

  it('accepts the same proofs on chain, and nothing else', async () => {
    await call(ALICE, 'publish', [tree.root, tree.packed()]);
    const check = async (t: Address, attester: Address, e: RootEntry, proof: string[]) =>
      Number((await call(BOB, 'check', [t.toString(), attester.toString(), e.level, e.sourceDigest, proof])).out[0]);
    expect(await check(a, ALICE, ea, tree.proof(ea)!)).toBe(2);
    expect(await check(b, ALICE, eb, tree.proof(eb)!)).toBe(1);
    expect(await check(a, ALICE, { ...ea, level: 1 }, tree.proof(ea)!)).toBe(0); // level is bound
    expect(await check(b, ALICE, ea, tree.proof(ea)!)).toBe(0); // so is the code at the target
    expect(await check(a, BOB, ea, tree.proof(ea)!)).toBe(0); // and the attester
  });

  it('keeps the previous root valid for one update', async () => {
    const next = new RootTree([...tree.entries, { codeHash: D('new'), level: 2, sourceDigest: D('n') }]);
    await call(ALICE, 'publish', [next.root, next.packed()]);
    const c = async (proof: string[]) => Number((await call(BOB, 'check', [a.toString(), ALICE.toString(), 2, ea.sourceDigest, proof])).out[0]);
    expect(await c(tree.proof(ea)!)).toBe(2);
    expect(await c(next.proof(ea)!)).toBe(2);
    const third = new RootTree([...next.entries, { codeHash: D('newer'), level: 2, sourceDigest: D('m') }]);
    await call(ALICE, 'publish', [third.root, third.packed()]);
    expect(await c(tree.proof(ea)!)).toBe(0);
    const [cur] = (await call(BOB, 'roots', [ALICE.toString(), 0])).out;
    const [prev] = (await call(BOB, 'roots', [ALICE.toString(), 1])).out;
    expect([cur, prev]).toEqual([third.root, next.root]);
  });
});
