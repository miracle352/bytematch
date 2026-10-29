import { serve } from '@hono/node-server';
import { config } from './config.js';
import { Chain } from './chain.js';
import { Store } from './store.js';
import { Attester } from './attest.js';
import { Sourcebound } from './service.js';
import { createApp } from './api.js';

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const chain = new Chain(config.rpcUrl);
const store = new Store(config.dataDir);
const attester =
  config.registryAddress && config.attesterKey
    ? new Attester(config.rpcUrl, config.chainId, config.registryAddress, config.attesterKey)
    : null;

const app = new Sourcebound(chain, store, attester, log);
const http = createApp(app, { registry: config.registryAddress || null });

serve({ fetch: http.fetch, port: config.port }, ({ port }) => {
  log(`sourcebound listening on :${port}, chain ${config.chainId} via ${config.rpcUrl}`);
  log(attester ? `attesting to ${config.registryAddress} as ${attester.address}` : 'attestation disabled (no REGISTRY_ADDRESS/ATTESTER_KEY)');
});
