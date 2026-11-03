import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { AbiCoder, ParamType } from 'ethers';
import type { ContractRecord } from './store.js';
import { describeError, normaliseAddress, type Bytematch, type Submission } from './service.js';
import { VerifyError, type ErrorCode } from './verify.js';
import { etherscanRoutes } from './etherscan.js';
import { coverage, type NetworkIndex } from './network.js';
import type { OnChainAttestation } from './attest.js';
import { callView, detectProxy, readState } from './inspect.js';
import { badgeSvg } from './badge.js';
import { mcpRoutes } from './mcp.js';
import { llmsTxt } from './llms.js';
import { RateLimiter } from './ratelimit.js';

const STATUS: Record<ErrorCode, 400 | 404 | 422> = {
  bad_input: 400,
  not_contract: 404,
  polkavm: 422,
  compile_error: 422,
  version_mismatch: 422,
  no_match: 422,
};

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 0x-prefixed 20-byte address');

const verifyBody = z
  .object({
    address,
    contract: z.string().optional(),
    compilerVersion: z.string().optional(),
    standardJsonInput: z
      .object({
        language: z.literal('Solidity'),
        sources: z.record(z.object({ content: z.string() })),
        settings: z.record(z.unknown()).optional(),
      })
      .optional(),
    metadata: z.string().optional(),
    files: z.record(z.string()).optional(),
  })
  .refine((b) => b.standardJsonInput || b.files, { message: 'send standardJsonInput, or files (optionally with metadata)' });

export function publicRecord(r: ContractRecord) {
  return {
    address: r.address,
    codeHash: r.codeHash,
    match: r.level,
    contract: { path: r.contractPath, name: r.contractName },
    compiler: {
      version: r.compilerVersion,
      evmVersion: r.evmVersion,
      optimizer: r.optimizer,
      viaIR: r.viaIR,
    },
    deployment: {
      tx: r.creationTx,
      deployer: r.deployer,
      block: r.deployBlock,
      constructorArgs: r.constructorArgs,
      constructorArgsDecoded: decodeConstructorArgs(r.abi, r.constructorArgs),
    },
    libraries: r.libraries,
    digest: r.digest,
    attestationTx: r.attestationTx,
    verifiedAt: r.verifiedAt,
  };
}

/** Constructor arguments as name/type/value, or null if they can't be decoded with the ABI. */
export function decodeConstructorArgs(abi: unknown[], encoded: string | null) {
  if (!encoded) return null;
  const ctor = (abi as Array<{ type: string; inputs?: Array<{ name: string; type: string }> }>).find((f) => f.type === 'constructor');
  if (!ctor?.inputs?.length) return encoded === '0x' ? [] : null;
  try {
    const values = AbiCoder.defaultAbiCoder().decode(ctor.inputs.map((i) => ParamType.from(i as never)), encoded);
    const show = (v: unknown): unknown =>
      typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(show) : v;
    return ctor.inputs.map((input, i) => ({ name: input.name, type: input.type, value: show(values[i]) }));
  } catch {
    return null;
  }
}

function fail(c: Context, e: unknown) {
  if (e instanceof VerifyError) {
    return c.json({ error: { code: e.code, message: e.message, details: e.details ?? null } }, STATUS[e.code]);
  }
  return c.json({ error: { code: 'internal', message: describeError(e) } }, 500);
}

const limiter = new RateLimiter(60_000);
const clientOf = (c: Context) => c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

export function createApp(
  app: Bytematch,
  info: { registry: string | null; roots?: string | null; network?: NetworkIndex; reader?: { read(target: string): Promise<OnChainAttestation> } | null },
) {
  const api = new Hono();
  api.use('*', cors());
  api.use('*', bodyLimit({ maxSize: 20 * 1024 * 1024 }));

  api.get('/health', async (c) => {
    const block = await app.chain.blockNumber().catch(() => null);
    return c.json({
      ok: block !== null,
      chainId: await app.chain.chainId().catch(() => null),
      block,
      registry: info.registry,
      roots: info.roots ?? null,
      attester: app.attester?.address ?? null,
    });
  });

  api.get('/v1/stats', async (c) => c.json(await app.store.countContracts()));

  // Every contract on the chain with its verification status.
  // ?status=verified|same-code|unverified filters the list; totals always cover everything.
  api.get('/v1/network', async (c) => {
    if (!info.network) return c.json({ error: { code: 'unavailable', message: 'network index disabled' } }, 503);
    try {
      const cov = await coverage(await info.network.get(), app.store);
      const status = c.req.query('status');
      const contracts = status ? cov.contracts.filter((r) => r.status === status) : cov.contracts;
      return c.json({ ...cov, contracts });
    } catch (e) {
      return fail(c, e);
    }
  });

  api.post('/v1/verify', async (c) => {
    if (!limiter.take(clientOf(c), 10)) return c.json({ error: { code: 'rate_limited', message: 'Too many verifications from this address. Wait a minute.' } }, 429);
    const parsed = verifyBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: { code: 'bad_input', message: parsed.error.issues.map((i) => i.message).join('; ') } }, 400);
    }
    const b = parsed.data;
    const submission: Submission = b.standardJsonInput
      ? { kind: 'standard-json', address: b.address, input: b.standardJsonInput, contract: b.contract, compilerVersion: b.compilerVersion }
      : b.metadata
        ? { kind: 'metadata', address: b.address, metadata: b.metadata, files: b.files! }
        : { kind: 'files', address: b.address, files: b.files!, contract: b.contract, compilerVersion: b.compilerVersion };
    try {
      return c.json(publicRecord(await app.submit(submission)), 201);
    } catch (e) {
      return fail(c, e);
    }
  });

  api.get('/v1/contracts', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
    return c.json({ items: (await app.store.listContracts(limit, offset)).map(publicRecord), limit, offset });
  });

  api.get('/v1/contracts/:address', async (c) => {
    try {
      const l = await app.lookup(c.req.param('address'));
      const [onChain, proxy] = await Promise.all([
        info.reader && l.codeHash ? info.reader.read(l.address).catch(() => null) : null,
        l.codeHash ? app.chain.getCode(l.address).then((code) => detectProxy(app.chain, l.address, code)).catch(() => null) : null,
      ]);
      const implementation = proxy ? await app.lookup(proxy.implementation).catch(() => null) : null;
      return c.json({
        status: l.status,
        address: l.address,
        codeHash: l.codeHash,
        verification: l.record ? publicRecord(l.record) : null,
        abi: l.record?.abi ?? null,
        onChain,
        proxy: proxy
          ? { ...proxy, status: implementation?.status ?? null, name: implementation?.record?.contractName ?? null, abi: implementation?.record?.abi ?? null }
          : null,
      });
    } catch (e) {
      return fail(c, e);
    }
  });

  const recordFor = async (c: Context) => {
    const l = await app.lookup(normaliseAddress(c.req.param('address')!));
    return l.record;
  };

  api.get('/v1/contracts/:address/abi', async (c) => {
    try {
      const r = await recordFor(c);
      return r ? c.json(r.abi) : c.json({ error: { code: 'unverified', message: 'not verified' } }, 404);
    } catch (e) {
      return fail(c, e);
    }
  });

  api.get('/v1/contracts/:address/files', async (c) => {
    try {
      const r = await recordFor(c);
      if (!r) return c.json({ error: { code: 'unverified', message: 'not verified' } }, 404);
      return c.json(Object.fromEntries(Object.entries(r.bundle.input.sources).map(([p, s]) => [p, s.content])));
    } catch (e) {
      return fail(c, e);
    }
  });

  api.get('/v1/contracts/:address/bundle', async (c) => {
    try {
      const r = await recordFor(c);
      if (!r) return c.json({ error: { code: 'unverified', message: 'not verified' } }, 404);
      c.header('content-disposition', `attachment; filename="${r.contractName}-${r.codeHash.slice(2, 10)}.bundle.json"`);
      return c.json(r.bundle);
    } catch (e) {
      return fail(c, e);
    }
  });

  // Live reads through the verified ABI (the implementation's, for a proxy).
  const abiFor = async (address: string) => {
    const l = await app.lookup(address);
    if (l.record) return l.record.abi;
    throw new VerifyError('bad_input', 'this contract is not verified, so its functions are unknown');
  };

  api.get('/v1/contracts/:address/state', async (c) => {
    try {
      const address = normaliseAddress(c.req.param('address'));
      const via = c.req.query('abi');
      const abi = await abiFor(via ? normaliseAddress(via) : address);
      return c.json({ address, values: await readState(app.chain, address, abi) });
    } catch (e) {
      return fail(c, e);
    }
  });

  api.post('/v1/contracts/:address/call', async (c) => {
    try {
      const address = normaliseAddress(c.req.param('address'));
      const b = (await c.req.json().catch(() => ({}))) as { function?: string; args?: unknown[]; abi?: string };
      if (!b.function) throw new VerifyError('bad_input', 'give the function to call, e.g. { "function": "balanceOf", "args": ["0x…"] }');
      const abi = await abiFor(b.abi ? normaliseAddress(b.abi) : address);
      return c.json({ result: await callView(app.chain, address, abi, b.function, b.args ?? []) });
    } catch (e) {
      return fail(c, e instanceof VerifyError ? e : new VerifyError('bad_input', describeError(e)));
    }
  });

  // README badge
  api.get('/badge/:file', async (c) => {
    const address = c.req.param('file').replace(/\.svg$/, '');
    let state: 'exact' | 'partial' | 'unverified' | 'none' = 'none';
    let text = 'no contract';
    try {
      const l = await app.lookup(normaliseAddress(address));
      if (l.record) {
        state = l.record.level;
        text = `${l.record.level} match`;
      } else if (l.status === 'unverified') {
        state = 'unverified';
        text = 'not verified';
      }
    } catch {
      text = 'invalid address';
    }
    c.header('content-type', 'image/svg+xml');
    c.header('cache-control', 'public, max-age=300');
    return c.body(badgeSvg(state, text));
  });

  // Whole repositories
  api.post('/v1/repos', async (c) => {
    if (!limiter.take(clientOf(c), 3)) return c.json({ error: { code: 'rate_limited', message: 'Too many repository checks from this address. Wait a minute.' } }, 429);
    const b = (await c.req.json().catch(() => ({}))) as { url?: string };
    try {
      if (!b.url) throw new VerifyError('bad_input', 'give the repository, e.g. { "url": "https://github.com/owner/repo" }');
      return c.json(await app.scanRepo(b.url), 201);
    } catch (e) {
      return fail(c, e instanceof VerifyError ? e : new VerifyError('bad_input', describeError(e)));
    }
  });

  api.get('/v1/repos', async (c) => c.json({ items: await app.repoIndex() }));

  api.get('/v1/repos/:owner/:repo', async (c) => {
    const r = await app.repoReport(`${c.req.param('owner')}/${c.req.param('repo')}`);
    return r ? c.json(r) : c.json({ error: { code: 'not_found', message: 'this repository has not been checked yet' } }, 404);
  });

  api.get('/llms.txt', (c) => {
    c.header('content-type', 'text/plain; charset=utf-8');
    return c.body(llmsTxt(new URL(c.req.url).origin));
  });

  api.route('/', mcpRoutes({ app, network: info.network, reader: info.reader }));
  api.route('/', etherscanRoutes(app));
  return api;
}
