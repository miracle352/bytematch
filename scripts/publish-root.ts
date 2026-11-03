// Publish one Merkle root covering every verification a Bytematch deployment holds.
// Runs where the attester key is; the deployment itself only reads.
//
//   npm run publish:root -- https://bytematch-portaldot.vercel.app           # dry run
//   npm run publish:root -- https://bytematch-portaldot.vercel.app --send
//
// The first publish pays the storage deposit for the root slots; later ones overwrite
// them and cost about 0.03 POT however many contracts they cover.

import { Contract, JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { config } from '../src/config.js';
import { RootTree, type RootEntry } from '../src/roots.js';
import { ROOTS_ABI } from '../src/rootsReader.js';

const base = process.argv[2]?.replace(/\/$/, '');
if (!base) throw new Error('usage: npm run publish:root -- <base url> [--send]');
if (!config.rootsAddress || !config.attesterKey) throw new Error('set ROOTS_ADDRESS and ATTESTER_KEY');

const entries: RootEntry[] = [];
for (let offset = 0; ; offset += 200) {
  const r = (await (await fetch(`${base}/v1/contracts?limit=200&offset=${offset}`)).json()) as {
    items: Array<{ codeHash: string; match: 'exact' | 'partial'; digest: string }>;
  };
  entries.push(...r.items.map((i) => ({ codeHash: i.codeHash, level: (i.match === 'exact' ? 2 : 1) as 1 | 2, sourceDigest: i.digest })));
  if (r.items.length < 200) break;
}
const tree = new RootTree(entries);

const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
const wallet = new Wallet(config.attesterKey, provider);
const roots = new Contract(config.rootsAddress, ROOTS_ABI, wallet);
const current = (await roots.getFunction('roots').staticCall(wallet.address, 0)) as string;
console.log(`${entries.length} verifications, ${tree.entries.length} distinct programs. Root ${tree.root}`);
if (current.toLowerCase() === tree.root) {
  console.log('already on chain');
  process.exit(0);
}
const data = roots.interface.encodeFunctionData('publish', [tree.root, tree.packed()]);
const gas = await provider.estimateGas({ from: wallet.address, to: config.rootsAddress, data });
const price = (await provider.getFeeData()).gasPrice ?? 0n;
console.log(`publishing costs ~${formatEther(gas * price)} POT; balance ${formatEther(await provider.getBalance(wallet.address))}`);
if (!process.argv.includes('--send')) process.exit(0);
const tx = await roots.getFunction('publish')(tree.root, tree.packed());
const receipt = await tx.wait();
if (receipt?.status !== 1) throw new Error(`publish failed in ${tx.hash}`);
console.log(`published in ${tx.hash}, block ${receipt.blockNumber}`);
