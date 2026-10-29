import { describe, expect, it } from 'vitest';
import { bundleDigest, canonicalJson, makeBundle } from '../src/bundle.js';
import { importsOf } from '../src/collect.js';
import { defaultEvmVersion } from '../src/compiler.js';

describe('bundle digest', () => {
  const input = {
    language: 'Solidity' as const,
    sources: { 'A.sol': { content: 'contract A {}' } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' },
  };

  it('does not depend on key order', () => {
    const reordered = { settings: { evmVersion: 'paris', optimizer: { runs: 200, enabled: true } }, sources: input.sources, language: 'Solidity' as const };
    expect(bundleDigest(makeBundle('0.8.28', 'A.sol:A', reordered))).toBe(bundleDigest(makeBundle('0.8.28', 'A.sol:A', input)));
  });

  it('ignores outputSelection, which never changes bytecode', () => {
    const withSelection = { ...input, settings: { ...input.settings, outputSelection: { '*': { '*': ['abi'] } } } };
    expect(bundleDigest(makeBundle('0.8.28', 'A.sol:A', withSelection))).toBe(bundleDigest(makeBundle('0.8.28', 'A.sol:A', input)));
  });

  it('changes when the source changes', () => {
    const edited = { ...input, sources: { 'A.sol': { content: 'contract A { }' } } };
    expect(bundleDigest(makeBundle('0.8.28', 'A.sol:A', edited))).not.toBe(bundleDigest(makeBundle('0.8.28', 'A.sol:A', input)));
  });

  it('serialises canonically', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
});

describe('import parsing', () => {
  it('finds every import form and skips commented-out ones', () => {
    const src = `
      import "./A.sol";
      import {B, C} from "@oz/B.sol";
      import * as D from '../D.sol';
      import "./E.sol" as E;
      // import "./Nope.sol";
      /* import "./AlsoNope.sol"; */
    `;
    expect(importsOf(src)).toEqual(['./A.sol', '@oz/B.sol', '../D.sol']);
  });
});

describe('default evm version', () => {
  it('follows solc release history', () => {
    expect(defaultEvmVersion('0.8.19')).toBe('paris');
    expect(defaultEvmVersion('0.8.24')).toBe('shanghai');
    expect(defaultEvmVersion('0.8.28')).toBe('cancun');
    expect(defaultEvmVersion('0.8.30+commit.73712a01')).toBe('prague');
  });
});
