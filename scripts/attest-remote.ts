// Attest verifications held by a live Bytematch deployment, from a machine that holds
// the attester key. The deployment itself never needs the key: it reads attestations
// from SourceRegistry with just the registry address.
//
//   npm run attest:remote -- https://bytematch-opal.vercel.app            # dry run
//   npm run attest:remote -- https://bytematch-opal.vercel.app --send     # attest
//
// One attestation per code hash covers every contract with that code.

import { formatEther } from 'ethers';
import { config } from '../src/config.js';
import { Attester, LEVEL_CODE, LEVEL_NAME } from '../src/attest.js';
import type { MatchLevel } from '../src/bytecode.js';

const base = process.argv[2]?.replace(/\/$/, '');
const send = process.argv.includes('--send');
if (!base) throw new Error('usage: npm run attest:remote -- <base url> [--send]');
if (!config.registryAddress || !config.attesterKey) throw new Error('set REGISTRY_ADDRESS and ATTESTER_KEY');

interface Item { address: string; codeHash: string; match: MatchLevel; digest: string; contract: { name: string } }

const { items } = (await (await fetch(`${base}/v1/contracts?limit=200`)).json()) as { items: Item[] };
const attester = new Attester(config.rpcUrl, config.chainId, config.registryAddress, config.attesterKey);
const provider = attester.wallet.provider!;

const byCode = new Map<string, Item>();
for (const it of items) {
  const prev = byCode.get(it.codeHash);
  if (!prev || (it.match === 'exact' && prev.match !== 'exact')) byCode.set(it.codeHash, it);
}

const todo: Item[] = [];
for (const it of byCode.values()) {
  const now = await attester.read(it.address);
  const done = now.sourceDigest === it.digest && LEVEL_NAME.indexOf(now.level) >= LEVEL_CODE[it.match];
  console.log(`${it.contract.name.padEnd(20)} ${it.match.padEnd(7)} ${done ? 'on chain' : 'missing'}`);
  if (!done) todo.push(it);
}

const balance = await provider.getBalance(attester.address);
console.log(`\n${byCode.size} distinct programs, ${todo.length} to attest. Attester balance ${formatEther(balance)} POT.`);
if (!todo.length || !send) {
  if (todo.length) console.log('Dry run. Each attestation holds roughly 7-8 POT as a storage deposit. Re-run with --send.');
  process.exit(0);
}

for (const it of todo) {
  try {
    const tx = await attester.attest(it.address, it.digest, it.match);
    console.log(`${it.contract.name.padEnd(20)} attested ${tx}`);
  } catch (e) {
    console.log(`${it.contract.name.padEnd(20)} failed: ${(e as Error).message.slice(0, 120)}`);
    break; // most likely out of funds; stop rather than fail every remaining one
  }
}
console.log(`balance now ${formatEther(await provider.getBalance(attester.address))} POT`);
