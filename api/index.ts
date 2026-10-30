// Vercel function: the whole API (REST, Etherscan-compatible /api, health) behind one
// handler. vercel.json rewrites API paths here and passes the original path in
// `__path`, so routing doesn't depend on how the platform reports rewritten URLs.

import { waitUntil } from '@vercel/functions';
import { buildApp } from '../src/app.js';
import { originalRequest } from '../src/rewrite.js';

// Built once per warm instance.
let ready: ReturnType<typeof buildApp> | null = null;

async function handle(request: Request): Promise<Response> {
  ready ??= buildApp({ defer: (work) => waitUntil(work) });
  const { http } = await ready;
  return http.fetch(originalRequest(request));
}

export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
export const HEAD = handle;
