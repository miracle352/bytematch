// Attest every stored verification that isn't on chain yet. Useful after deploying a
// new registry or after verifying while attestation was disabled.
//
//   REGISTRY_ADDRESS=0x... ATTESTER_KEY=0x... npm run attest:all
//
// One attestation per distinct code hash is enough: contracts sharing code are covered.

import { formatEther } from 'ethers';
import { config } from '../src/config.js';
import { Store } from '../src/store.js';
import { Attester } from '../src/attest.js';

if (!config.registryAddress || !config.attesterKey) throw new Error('set REGISTRY_ADDRESS and ATTESTER_KEY');

const store = new Store(config.dataDir);
const attester = new Attester(config.rpcUrl, config.chainId, config.registryAddress, config.attesterKey);
const provider = attester.wallet.provider!;
const before = await provider.getBalance(attester.address);

const seen = new Set<string>();
let sent = 0;
for (const r of store.listContracts(10_000)) {
  if (seen.has(r.codeHash)) continue;
  seen.add(r.codeHash);
  const tx = await attester.attest(r.address, r.digest, r.level);
  if (tx) {
    store.setAttestation(r.address, tx);
    sent++;
    console.log(`${r.contractName.padEnd(20)} ${r.level.padEnd(7)} ${tx}`);
  } else {
    console.log(`${r.contractName.padEnd(20)} already attested`);
  }
}

const after = await provider.getBalance(attester.address);
console.log(`${sent} attestations, ${formatEther(before - after)} POT spent, ${formatEther(after)} POT left`);
