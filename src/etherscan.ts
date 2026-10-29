// Etherscan-compatible API, so existing tooling works unchanged:
//
//   forge verify-contract <address> src/Token.sol:Token \
//     --verifier etherscan --verifier-url https://<host>/api --etherscan-api-key any \
//     --chain 420420777
//
//   hardhat.config: etherscan.customChains = [{ network: 'portaldot', chainId: 420420777,
//     urls: { apiURL: 'https://<host>/api', browserURL: 'https://<host>' } }]
//
// Covers the calls those tools make: verifysourcecode, checkverifystatus, getsourcecode,
// getabi. Both the v1 shape (/api) and v2 shape (/v2/api?chainid=...) are accepted.

import { Hono, type Context } from 'hono';
import type { StandardJsonInput } from './compiler.js';
import { describeError, type Sourcebound, type Submission } from './service.js';
import { config } from './config.js';

type Params = Record<string, string>;

async function params(c: Context): Promise<Params> {
  const out: Params = { ...c.req.query() };
  if (c.req.method === 'POST') {
    const type = c.req.header('content-type') ?? '';
    if (type.includes('application/json')) {
      Object.assign(out, (await c.req.json().catch(() => ({}))) as Params);
    } else {
      const body = await c.req.parseBody().catch(() => ({}));
      for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out[k] = v;
    }
  }
  return out;
}

const ok = (result: unknown) => ({ status: '1', message: 'OK', result });
const notOk = (result: unknown, message = 'NOTOK') => ({ status: '0', message, result });

function submissionFrom(p: Params): Submission {
  const address = p.contractaddress ?? '';
  const format = p.codeformat ?? 'solidity-single-file';
  const compilerVersion = p.compilerversion?.replace(/^v/, '');
  const source = p.sourceCode ?? p.sourcecode ?? '';
  const contract = p.contractname;

  if (format === 'solidity-standard-json-input') {
    // Etherscan historically wraps this in an extra pair of braces.
    const raw = source.startsWith('{{') && source.endsWith('}}') ? source.slice(1, -1) : source;
    return { kind: 'standard-json', address, input: JSON.parse(raw) as StandardJsonInput, contract, compilerVersion };
  }

  const name = contract?.split(':').pop() ?? 'Contract';
  const input: StandardJsonInput = {
    language: 'Solidity',
    sources: { [`${name}.sol`]: { content: source } },
    settings: {
      optimizer: { enabled: p.optimizationUsed === '1', runs: Number(p.runs ?? 200) },
      ...(p.evmversion && p.evmversion !== 'default' ? { evmVersion: p.evmversion } : {}),
    },
  };
  return { kind: 'standard-json', address, input, contract: name, compilerVersion };
}

export function etherscanRoutes(app: Sourcebound) {
  const r = new Hono();

  const handler = async (c: Context) => {
    const p = await params(c);
    if (p.chainid && Number(p.chainid) !== config.chainId) {
      return c.json(notOk(`this endpoint serves chain ${config.chainId}`));
    }
    if (p.module !== 'contract') return c.json(notOk(`unsupported module ${p.module ?? ''}`));

    switch (p.action) {
      case 'verifysourcecode': {
        try {
          const s = submissionFrom(p);
          const existing = await app.lookup(s.address).catch(() => null);
          if (existing?.status === 'verified' && existing.record?.level === 'exact') {
            return c.json(notOk('Contract source code already verified'));
          }
          return c.json(ok(app.submitJob(s)));
        } catch (e) {
          return c.json(notOk(describeError(e)));
        }
      }

      case 'checkverifystatus': {
        const job = app.store.getJob(p.guid ?? '');
        if (!job) return c.json(notOk('Unknown GUID'));
        if (job.status === 'pending') return c.json(notOk('Pending in queue'));
        return c.json(job.status === 'pass' ? ok(job.message) : notOk(job.message));
      }

      case 'getsourcecode': {
        const l = await app.lookup(p.address ?? '').catch(() => null);
        const rec = l?.record;
        if (!rec) {
          return c.json(
            ok([{ SourceCode: '', ABI: 'Contract source code not verified', ContractName: '', CompilerVersion: '', OptimizationUsed: '', Runs: '', ConstructorArguments: '', EVMVersion: '', Library: '', LicenseType: '', Proxy: '0', Implementation: '', SwarmSource: '' }]),
          );
        }
        return c.json(
          ok([
            {
              SourceCode: `{${JSON.stringify(rec.bundle.input)}}`,
              ABI: JSON.stringify(rec.abi),
              ContractName: rec.contractName,
              CompilerVersion: `v${rec.compilerVersion}`,
              OptimizationUsed: rec.optimizer?.enabled ? '1' : '0',
              Runs: String(rec.optimizer?.runs ?? 200),
              ConstructorArguments: rec.constructorArgs?.replace(/^0x/, '') ?? '',
              EVMVersion: rec.evmVersion ?? 'Default',
              Library: Object.entries(rec.libraries).map(([k, v]) => `${k.split(':').pop()}:${v}`).join(';'),
              LicenseType: '',
              Proxy: '0',
              Implementation: '',
              SwarmSource: '',
            },
          ]),
        );
      }

      case 'getabi': {
        const l = await app.lookup(p.address ?? '').catch(() => null);
        return l?.record ? c.json(ok(JSON.stringify(l.record.abi))) : c.json(notOk('Contract source code not verified'));
      }

      default:
        return c.json(notOk(`unsupported action ${p.action ?? ''}`));
    }
  };

  for (const path of ['/api', '/v2/api']) {
    r.get(path, handler);
    r.post(path, handler);
  }
  return r;
}
