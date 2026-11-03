// Deploy SourceRoots and record it in deployments/portaldot-testnet.json.
//
//   ATTESTER_KEY=0x... npm run deploy:roots            # prints the cost, sends nothing
//   ATTESTER_KEY=0x... npm run deploy:roots -- --send
//
// Nothing here prints the key.

import { readFileSync, writeFileSync } from 'node:fs';
import { ContractFactory, JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { config } from '../src/config.js';
import { compile, compileErrors, type StandardJsonInput } from '../src/compiler.js';

if (!config.attesterKey) throw new Error('set ATTESTER_KEY (a funded testnet key)');
const KEY = 'contracts/SourceRoots.sol';
const input: StandardJsonInput = {
  language: 'Solidity',
  sources: { [KEY]: { content: readFileSync(KEY, 'utf8') } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', metadata: { bytecodeHash: 'ipfs' } },
};
const out = await compile('0.8.28', input);
const errors = compileErrors(out);
if (errors.length) throw new Error(errors.join('\n'));
const c = out.contracts![KEY]!.SourceRoots!;

const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
const wallet = new Wallet(config.attesterKey, provider);
const factory = new ContractFactory(c.abi as never, '0x' + c.evm.bytecode.object, wallet);
const estimate = await provider.estimateGas({ ...(await factory.getDeployTransaction()), from: wallet.address });
const price = (await provider.getFeeData()).gasPrice ?? 0n;
const balance = await provider.getBalance(wallet.address);
console.log(`deployer ${wallet.address}: ${formatEther(balance)} POT; deploy costs ~${formatEther(estimate * price)} POT`);
if (!process.argv.includes('--send')) process.exit(0);
if (balance < estimate * price) throw new Error('balance too low');

const contract = await factory.deploy();
const tx = contract.deploymentTransaction()!;
console.log(`sent ${tx.hash}`);
const receipt = await tx.wait();
if (receipt?.status !== 1) throw new Error(`deploy failed in ${tx.hash}`);
const address = (await contract.getAddress()).toLowerCase();
console.log(`SourceRoots at ${address}, block ${receipt.blockNumber}`);

const file = 'deployments/portaldot-testnet.json';
const d = JSON.parse(readFileSync(file, 'utf8'));
d.SourceRoots = { address, tx: tx.hash, block: receipt.blockNumber, deployer: wallet.address.toLowerCase(), compiler: '0.8.28', settings: input.settings, source: KEY };
writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
console.log(`wrote ${file}. Set ROOTS_ADDRESS=${address} ROOTS_FROM_BLOCK=${receipt.blockNumber}.`);
