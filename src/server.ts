import { serve } from '@hono/node-server';
import { config } from './config.js';
import { Chain } from './chain.js';
import { Store } from './store.js';
import { Attester } from './attest.js';
import { Bytematch } from './service.js';
import { createApp } from './api.js';
import { NetworkIndex } from './network.js';

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const chain = new Chain(config.rpcUrl);
const store = new Store(config.dataDir);
const attester =
  config.registryAddress && config.attesterKey
    ? new Attester(config.rpcUrl, config.chainId, config.registryAddress, config.attesterKey)
    : null;

const network = new NetworkIndex(chain, config.substrateUrl);
const app = new Bytematch(chain, store, attester, log);
const http = createApp(app, { registry: config.registryAddress || null, network });

// Warm the contract list so the first /v1/network request is fast.
network.refresh().then(
  (s) => log(`indexed ${s.contracts.length} contracts`),
  (e: Error) => log(`contract index failed: ${e.message}`),
);

serve({ fetch: http.fetch, port: config.port }, ({ port }) => {
  log(`bytematch listening on :${port}, chain ${config.chainId} via ${config.rpcUrl}`);
  log(attester ? `attesting to ${config.registryAddress} as ${attester.address}` : 'attestation disabled (no REGISTRY_ADDRESS/ATTESTER_KEY)');
});
