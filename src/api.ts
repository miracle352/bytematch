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

export function createApp(
  app: Bytematch,
  info: { registry: string | null; network?: NetworkIndex; reader?: { read(target: string): Promise<OnChainAttestation> } | null },
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
      const onChain =
        info.reader && l.codeHash ? await info.reader.read(l.address).catch(() => null) : null;
      return c.json({
        status: l.status,
        address: l.address,
        codeHash: l.codeHash,
        verification: l.record ? publicRecord(l.record) : null,
        abi: l.record?.abi ?? null,
        onChain,
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

  api.route('/', etherscanRoutes(app));
  return api;
}
