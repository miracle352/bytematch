// What a verified ABI lets you do with a live contract: see through proxies, read its
// public state, and call its view functions.

import { Interface, type FunctionFragment } from 'ethers';
import type { Chain } from './chain.js';
import { strip0x } from './bytecode.js';

const EIP1967_IMPLEMENTATION = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const EIP1967_BEACON = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const EIP1167 = /^363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/;

export interface Proxy {
  kind: 'eip1967' | 'beacon' | 'eip1167';
  implementation: string;
}

const slotAddress = (word: string) => {
  const h = strip0x(word).padStart(64, '0');
  const a = '0x' + h.slice(24);
  return /^0x0{40}$/.test(a) ? null : a;
};

export async function detectProxy(chain: Chain, address: string, code: string): Promise<Proxy | null> {
  const clone = strip0x(code).match(EIP1167);
  if (clone) return { kind: 'eip1167', implementation: '0x' + clone[1] };
  const impl = slotAddress(await chain.storageAt(address, EIP1967_IMPLEMENTATION).catch(() => '0x'));
  if (impl) return { kind: 'eip1967', implementation: impl };
  const beacon = slotAddress(await chain.storageAt(address, EIP1967_BEACON).catch(() => '0x'));
  if (beacon) {
    // IBeacon.implementation()
    const out = await chain.call(beacon, '0x5c60da1b').catch(() => '0x');
    const a = out.length >= 66 ? slotAddress(out) : null;
    if (a) return { kind: 'beacon', implementation: a };
  }
  return null;
}

function show(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(show);
  return v;
}

function readable(abi: unknown[]): FunctionFragment[] {
  const iface = new Interface(abi as never);
  return iface.fragments.filter(
    (f): f is FunctionFragment => f.type === 'function' && ((f as FunctionFragment).stateMutability === 'view' || (f as FunctionFragment).stateMutability === 'pure'),
  );
}

export interface StateValue {
  name: string;
  signature: string;
  outputs: string[];
  value: unknown;
  error?: string;
}

/** Every view function without arguments, called once. */
export async function readState(chain: Chain, address: string, abi: unknown[], limit = 40): Promise<StateValue[]> {
  const iface = new Interface(abi as never);
  const fns = readable(abi).filter((f) => f.inputs.length === 0).slice(0, limit);
  const out: StateValue[] = [];
  for (let i = 0; i < fns.length; i += 6) {
    out.push(
      ...(await Promise.all(
        fns.slice(i, i + 6).map(async (f) => {
          const base = { name: f.name, signature: f.format('sighash'), outputs: f.outputs.map((o) => o.type) };
          try {
            const raw = await chain.call(address, iface.encodeFunctionData(f, []));
            const decoded = iface.decodeFunctionResult(f, raw);
            return { ...base, value: show(decoded.length === 1 ? decoded[0] : [...decoded]) };
          } catch (e) {
            return { ...base, value: null, error: (e as Error).message.split('\n')[0]!.slice(0, 140) };
          }
        }),
      )),
    );
  }
  return out;
}

/** Call one view function by name or signature with JSON arguments. */
export async function callView(chain: Chain, address: string, abi: unknown[], fn: string, args: unknown[]): Promise<unknown> {
  const iface = new Interface(abi as never);
  const f = readable(abi).find((x) => x.name === fn || x.format('sighash') === fn);
  if (!f) throw new Error(`${fn} is not a view function of this contract`);
  if (args.length !== f.inputs.length) throw new Error(`${f.format('sighash')} takes ${f.inputs.length} arguments, got ${args.length}`);
  const raw = await chain.call(address, iface.encodeFunctionData(f, args));
  const decoded = iface.decodeFunctionResult(f, raw);
  return show(decoded.length === 1 ? decoded[0] : [...decoded]);
}
