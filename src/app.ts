// Builds the HTTP app with its dependencies. Shared by the local server (src/server.ts)
// and the Vercel function (api/index.ts).

import { config } from './config.js';
import { Chain } from './chain.js';
import { openStore } from './store.js';
import { Attester } from './attest.js';
import { Bytematch, type Defer } from './service.js';
import { createApp } from './api.js';
import { NetworkIndex } from './network.js';

export async function buildApp(opts: { log?: (msg: string) => void; defer?: Defer } = {}) {
  const log = opts.log ?? ((msg: string) => console.log(`${new Date().toISOString()} ${msg}`));
  const chain = new Chain(config.rpcUrl);
  const store = await openStore(config.dataDir);
  const attester =
    config.registryAddress && config.attesterKey
      ? new Attester(config.rpcUrl, config.chainId, config.registryAddress, config.attesterKey)
      : null;
  const network = new NetworkIndex(chain, config.substrateUrl, store);
  const app = new Bytematch(chain, store, attester, log, opts.defer);
  const http = createApp(app, { registry: config.registryAddress || null, network });
  return { http, app, network, attester, log };
}
