import { serve } from '@hono/node-server';
import { config } from './config.js';
import { buildApp } from './app.js';

const { http, network, attester, log } = await buildApp();

serve({ fetch: http.fetch, port: config.port }, ({ port }) => {
  log(`bytematch listening on :${port}, chain ${config.chainId} via ${config.rpcUrl}`);
  log(attester ? `attesting to ${config.registryAddress} as ${attester.address}` : 'attestation disabled (no REGISTRY_ADDRESS/ATTESTER_KEY)');
});

// Warm the contract list so the first /v1/network request is fast.
network.refresh().then(
  (s) => log(`indexed ${s.contracts.length} contracts`),
  (e: Error) => log(`contract index failed: ${e.message}`),
);
