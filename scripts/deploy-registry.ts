// Deploy SourceRegistry, then verify the deployment with Sourcebound's own verifier
// and record everything in deployments/<network>.json.
//
//   ATTESTER_KEY=0x... npm run deploy:registry
//
// The key only needs testnet POT. Nothing here prints it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { ContractFactory, JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { config } from '../src/config.js';
import { Chain } from '../src/chain.js';
import { verify } from '../src/verify.js';
import { bundleDigest, makeBundle } from '../src/bundle.js';
import { buildRegistry, REGISTRY_COMPILER, REGISTRY_SOURCE_KEY } from './registry-build.js';

if (!config.attesterKey) throw new Error('set ATTESTER_KEY (a funded testnet key)');

const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
const wallet = new Wallet(config.attesterKey, provider);
const build = await buildRegistry();

const balance = await provider.getBalance(wallet.address);
console.log(`deployer ${wallet.address}, balance ${formatEther(balance)} POT`);

const factory = new ContractFactory(build.abi as never, build.bytecode, wallet);
const estimate = await provider.estimateGas({ ...(await factory.getDeployTransaction()), from: wallet.address });
const price = (await provider.getFeeData()).gasPrice ?? 0n;
console.log(`estimated cost ${formatEther(estimate * price)} POT (mostly the code storage deposit)`);
if (balance < estimate * price) throw new Error('balance too low for the deploy');

const contract = await factory.deploy();
const tx = contract.deploymentTransaction()!;
console.log(`sent ${tx.hash}`);
const receipt = await tx.wait();
if (receipt?.status !== 1) throw new Error(`deploy failed in ${tx.hash}`);
const address = (await contract.getAddress()).toLowerCase();
console.log(`SourceRegistry at ${address}, block ${receipt.blockNumber}`);

// The registry is the first contract Sourcebound verifies.
const v = await verify(new Chain(config.rpcUrl), {
  address,
  input: build.input,
  contract: `${REGISTRY_SOURCE_KEY}:SourceRegistry`,
  compilerVersion: REGISTRY_COMPILER,
});
const digest = bundleDigest(makeBundle(v.compilerVersion, `${v.contractPath}:${v.contractName}`, v.input));
console.log(`self-verification: ${v.level} match, digest ${digest}`);

mkdirSync('deployments', { recursive: true });
const file = `deployments/portaldot-testnet.json`;
writeFileSync(
  file,
  JSON.stringify(
    {
      chainId: config.chainId,
      SourceRegistry: {
        address,
        tx: tx.hash,
        block: receipt.blockNumber,
        deployer: wallet.address.toLowerCase(),
        codeHash: v.codeHash,
        compiler: v.compilerVersion,
        settings: build.input.settings,
        source: REGISTRY_SOURCE_KEY,
        verification: { level: v.level, digest },
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${file}. Set REGISTRY_ADDRESS=${address} to enable attestation.`);
