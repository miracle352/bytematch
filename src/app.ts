// Builds the HTTP app with its dependencies. Shared by the local server (src/server.ts)
// and the Vercel function (api/index.ts).

import { config } from './config.js';
import { Chain } from './chain.js';
import { openStore } from './store.js';
import { Attester, RegistryReader } from './attest.js';
import { Bytematch, type Defer } from './service.js';
import { createApp } from './api.js';
import { NetworkIndex } from './network.js';
import { JsonRpcProvider } from 'ethers';
import { onChainReader, RootsReader } from './rootsReader.js';

export async function buildApp(opts: { log?: (msg: string) => void; defer?: Defer } = {}) {
  const log = opts.log ?? ((msg: string) => console.log(`${new Date().toISOString()} ${msg}`));
  const chain = new Chain(config.rpcUrl);
  const store = await openStore(config.dataDir);
  const attester =
    config.registryAddress && config.attesterKey
      ? new Attester(config.rpcUrl, config.chainId, config.registryAddress, config.attesterKey)
      : null;
  const registryReader: Pick<RegistryReader, 'read'> | null = attester
    ? attester
    : config.registryAddress
      ? new RegistryReader(config.rpcUrl, config.chainId, config.registryAddress, config.attesterAddress)
      : null;
  const roots = config.rootsAddress
    ? new RootsReader(new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true }), config.rootsAddress, config.attesterAddress, config.rootsFromBlock)
    : null;
  const reader = onChainReader(registryReader, roots);
  const network = new NetworkIndex(chain, config.substrateUrl, store);
  const app = new Bytematch(chain, store, attester, log, opts.defer);
  const http = createApp(app, { registry: config.registryAddress || null, roots: config.rootsAddress || null, network, reader });
  return { http, app, network, attester, log };
}
