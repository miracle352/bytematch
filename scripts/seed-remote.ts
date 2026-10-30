// Re-run every locally stored verification against another Bytematch deployment, e.g.
// a fresh Vercel deploy whose database starts empty:
//
//   npm run seed:remote -- https://bytematch.vercel.app
//
// It sends each stored bundle (the exact standard JSON input that matched), so the
// remote service verifies from scratch rather than trusting this copy.

import { config } from '../src/config.js';
import { openStore } from '../src/store.js';

const target = process.argv[2]?.replace(/\/$/, '');
if (!target) throw new Error('usage: npm run seed:remote -- <base url>');

const store = await openStore(config.dataDir);
const records = await store.listContracts(10_000);
console.log(`sending ${records.length} verifications to ${target}`);

for (const r of records) {
  const res = await fetch(`${target}/v1/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      address: r.address,
      contract: r.bundle.contract,
      compilerVersion: r.bundle.compiler,
      standardJsonInput: r.bundle.input,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { match?: string; error?: { message: string } };
  console.log(`${r.contractName.padEnd(20)} ${res.status} ${body.match ?? body.error?.message ?? ''}`);
}
