// Against the real Portaldot V3 testnet. Run with: npm run test:live
//
// Fixture: PlaqueLite from github.com/unifyWeb3/plaque (MIT), deployed by its authors at
// 0x5432…b685. Its build settings are recorded in that repo's scripts/build-config.mjs.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Chain } from '../../src/chain.js';
import { verify, verifyAuto, VerifyError } from '../../src/verify.js';
import { config } from '../../src/config.js';

const live = describe.skipIf(!process.env.LIVE);
const chain = new Chain(config.rpcUrl);
const PLAQUE = '0x5432e6b89dc3042d47f2be98e971cad9dabab685';
const source = readFileSync(new URL('../fixtures/PlaqueLite.sol', import.meta.url), 'utf8');
const settings = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', metadata: { bytecodeHash: 'ipfs' as const } };

live('Portaldot V3 testnet', { timeout: 180_000 }, () => {
  it('finds the deploy transaction', async () => {
    const c = await chain.findCreation(PLAQUE);
    expect(c?.blockNumber).toBe(167044);
    expect(c?.txHash).toBe('0xcee4d1db6c86250faa16bd67419168c7628c8a88533bf3d84316ccfd0c3bb63a');
  });

  it('matches exactly with the original source path', async () => {
    const v = await verify(chain, {
      address: PLAQUE,
      input: { language: 'Solidity', sources: { '/root/hack/contracts/PlaqueLite.sol': { content: source } }, settings },
    });
    expect(v.level).toBe('exact');
    expect(v.creationLevel).toBe('exact');
    expect(v.compilerVersion).toBe('0.8.28+commit.7893614a');
  });

  it('matches partially with another path', async () => {
    const v = await verify(chain, {
      address: PLAQUE,
      input: { language: 'Solidity', sources: { 'PlaqueLite.sol': { content: source } }, settings },
    });
    expect(v.level).toBe('partial');
  });

  it('recovers the settings from the source file alone', async () => {
    const v = await verifyAuto(chain, { address: PLAQUE, sources: { 'PlaqueLite.sol': { content: source } } });
    expect(v.input.settings).toMatchObject({ optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', viaIR: false });
  });

  it('rejects a wrong compiler version before compiling', async () => {
    const err = await verify(chain, {
      address: PLAQUE,
      compilerVersion: '0.8.24',
      input: { language: 'Solidity', sources: { 'PlaqueLite.sol': { content: source } }, settings },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(VerifyError);
    expect((err as VerifyError).code).toBe('version_mismatch');
  });
});
