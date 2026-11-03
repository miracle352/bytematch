// Model Context Protocol endpoint (streamable HTTP, stateless, JSON responses) so agents
// can check, verify and read Portaldot contracts the same way people do on the site.
//
//   claude mcp add --transport http bytematch https://<host>/mcp

import { Hono } from 'hono';
import type { Bytematch } from './service.js';
import { describeError, normaliseAddress, summarise } from './service.js';
import type { NetworkIndex } from './network.js';
import { coverage } from './network.js';
import type { OnChainAttestation } from './attest.js';
import { callView, detectProxy, readState } from './inspect.js';
import type { StandardJsonInput } from './compiler.js';

interface Deps {
  app: Bytematch;
  network?: NetworkIndex;
  reader?: { read(target: string): Promise<OnChainAttestation> } | null;
}

const address = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'Contract address on Portaldot V3 (EVM, 0x-prefixed)' };

export const TOOLS = [
  {
    name: 'check_contract',
    description:
      'Is the code at this Portaldot V3 address verified against source? Returns exact (byte for byte), partial (same code, different metadata), same-code (identical to a verified contract), unverified or not-a-contract, with the contract name, compiler settings, proxy target and on-chain attestation.',
    inputSchema: { type: 'object', properties: { address }, required: ['address'] },
  },
  {
    name: 'verify_repository',
    description:
      'Find every contract a public GitHub repository deployed to Portaldot V3 and verify each one against the repository source. Takes up to a few minutes for large repositories.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'https://github.com/owner/repo, optionally /tree/<ref>' } },
      required: ['url'],
    },
  },
  {
    name: 'verify_source',
    description:
      'Verify one deployed contract from Solidity files. Without settings, the compiler version is read from the bytecode and common settings are tried.',
    inputSchema: {
      type: 'object',
      properties: {
        address,
        files: { type: 'object', additionalProperties: { type: 'string' }, description: 'Path to Solidity source, including every imported file' },
        contract: { type: 'string', description: 'Optional "path:Name"' },
        settings: { type: 'object', description: 'Optional solc settings: optimizer, viaIR, evmVersion, metadata, remappings' },
        compilerVersion: { type: 'string' },
      },
      required: ['address', 'files'],
    },
  },
  {
    name: 'read_contract',
    description:
      'Read a verified contract: with no function, returns every public value (view functions without arguments); with a function, calls it with args.',
    inputSchema: {
      type: 'object',
      properties: { address, function: { type: 'string', description: 'Name or signature, e.g. balanceOf(address)' }, args: { type: 'array' } },
      required: ['address'],
    },
  },
  {
    name: 'network_coverage',
    description: 'How many contracts deployed on Portaldot V3 have verified source, and which ones.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

export async function runTool(deps: Deps, name: string, args: Record<string, any>): Promise<unknown> {
  const { app } = deps;
  switch (name) {
    case 'check_contract': {
      const l = await app.lookup(normaliseAddress(String(args.address)));
      const code = l.codeHash ? await app.chain.getCode(l.address) : '0x';
      const proxy = l.codeHash ? await detectProxy(app.chain, l.address, code) : null;
      const r = l.record;
      return {
        status: l.status,
        address: l.address,
        codeHash: l.codeHash,
        match: r?.level ?? null,
        contract: r ? `${r.contractPath}:${r.contractName}` : null,
        compiler: r ? { version: r.compilerVersion, optimizer: r.optimizer, viaIR: r.viaIR, evmVersion: r.evmVersion } : null,
        sameCodeAs: l.status === 'same-code' ? r?.address : null,
        proxy,
        onChain: deps.reader && l.codeHash ? await deps.reader.read(l.address).catch(() => null) : null,
      };
    }
    case 'verify_repository': {
      const report = await app.scanRepo(String(args.url));
      return { ...summarise(report), contracts: report.contracts, projects: report.projects };
    }
    case 'verify_source': {
      const files = args.files as Record<string, string>;
      const r = args.settings
        ? await app.submit({
            kind: 'standard-json',
            address: String(args.address),
            input: {
              language: 'Solidity',
              sources: Object.fromEntries(Object.entries(files).map(([p, content]) => [p, { content }])),
              settings: args.settings,
            } as StandardJsonInput,
            contract: args.contract,
            compilerVersion: args.compilerVersion,
          })
        : await app.submit({ kind: 'files', address: String(args.address), files, contract: args.contract, compilerVersion: args.compilerVersion });
      return { match: r.level, contract: `${r.contractPath}:${r.contractName}`, compiler: r.compilerVersion, address: r.address, codeHash: r.codeHash };
    }
    case 'read_contract': {
      const l = await app.lookup(normaliseAddress(String(args.address)));
      if (!l.record) throw new Error('this contract is not verified, so its functions are unknown');
      if (args.function) return { result: await callView(app.chain, l.address, l.record.abi, String(args.function), (args.args as unknown[]) ?? []) };
      return { values: await readState(app.chain, l.address, l.record.abi) };
    }
    case 'network_coverage': {
      if (!deps.network) throw new Error('network index unavailable');
      const cov = await coverage(await deps.network.get(), app.store);
      return { totals: cov.totals, verified: cov.contracts.filter((c) => c.status !== 'unverified').map((c) => ({ address: c.address, name: c.name, status: c.status, match: c.match })) };
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any };

export function mcpRoutes(deps: Deps) {
  const r = new Hono();

  const handle = async (msg: Rpc) => {
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id ?? null, result });
    const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
    if (msg.id === undefined) return null; // notification: nothing to answer
    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'bytematch', version: '1.0.0' },
          instructions: 'Source verification for contracts on Portaldot V3. Start with check_contract for any address.',
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        try {
          const result = await runTool(deps, msg.params?.name, msg.params?.arguments ?? {});
          return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result });
        } catch (e) {
          return reply({ content: [{ type: 'text', text: describeError(e) }], isError: true });
        }
      }
      default:
        return error(-32601, `method ${msg.method} not found`);
    }
  };

  r.post('/mcp', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, 400);
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(handle))).filter(Boolean);
      return out.length ? c.json(out) : c.body(null, 202);
    }
    const out = await handle(body as Rpc);
    return out ? c.json(out) : c.body(null, 202);
  });
  r.get('/mcp', (c) => c.json({ error: 'POST JSON-RPC to this endpoint; server-sent events are not offered' }, 405));
  return r;
}
