import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findProjects, hardhatSettings, mentionedAddresses, parseFoundryToml, parseRepoUrl, untar } from '../src/repo.js';
import { badgeSvg } from '../src/badge.js';

describe('repository URLs', () => {
  it('accepts the usual forms', () => {
    expect(parseRepoUrl('https://github.com/Junedkhan121/portalswap')).toEqual({ owner: 'Junedkhan121', repo: 'portalswap', ref: 'HEAD' });
    expect(parseRepoUrl('github.com/a/b.git')).toMatchObject({ owner: 'a', repo: 'b' });
    expect(parseRepoUrl('https://github.com/a/b/tree/dev')).toMatchObject({ ref: 'dev' });
    expect(parseRepoUrl('a/b')).toMatchObject({ owner: 'a', repo: 'b' });
    expect(() => parseRepoUrl('https://gitlab.com/a/b')).toThrow();
  });
});

describe('config files, read as text', () => {
  it('foundry.toml', () => {
    const t = parseFoundryToml(`[profile.default]
src = "src"
solc_version = "0.8.28" # pinned
optimizer = true
optimizer_runs = 1_000
via_ir = true
bytecode_hash = "none"
remappings = [
  "forge-std/=lib/forge-std/src/",
  "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
]
[fuzz]
runs = 5`);
    expect(t).toMatchObject({ solc_version: '0.8.28', optimizer: true, optimizer_runs: 1000, via_ir: true, bytecode_hash: 'none' });
    expect(t.remappings).toHaveLength(2);
    expect(t.runs).toBeUndefined(); // [fuzz] runs is not the optimizer's
  });

  it('hardhat.config without running it', () => {
    const h = hardhatSettings(`module.exports = { solidity: { version: "0.8.20", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", viaIR: true } }, paths: { sources: "./src" } }`);
    expect(h.settings).toMatchObject({ version: '0.8.20', optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', viaIR: true });
    expect(h.src).toBe('src');
    expect(hardhatSettings(`export default { solidity: "0.8.24" }`).settings.version).toBe('0.8.24');
  });
});

describe('repository archives', () => {
  it('reads a git archive (the format GitHub serves) and finds nested projects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bm-repo-'));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir });
    git('init', '-q');
    mkdirSync(join(dir, 'contracts/src'), { recursive: true });
    mkdirSync(join(dir, 'node_modules/x'), { recursive: true });
    writeFileSync(join(dir, 'contracts/foundry.toml'), '[profile.default]\nsolc = "0.8.28"\n');
    writeFileSync(join(dir, 'contracts/src/A.sol'), 'contract A {}');
    writeFileSync(join(dir, 'node_modules/x/B.sol'), 'contract B {}');
    writeFileSync(join(dir, 'README.md'), `Deployed at 0x${'ab'.repeat(20)}; asset precompile 0x0000000200000000000000000000000000010000`);
    git('add', '-A', '-f');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
    git('archive', '--format=tar.gz', '--prefix=repo-main/', 'HEAD', '-o', join(dir, 'a.tgz'));

    const files = untar(readFileSync(join(dir, 'a.tgz')));
    expect(files.get('contracts/src/A.sol')).toBe('contract A {}');
    expect([...files.keys()].some((k) => k.includes('node_modules'))).toBe(false);
    expect(findProjects(files)).toMatchObject([{ root: 'contracts', tool: 'foundry', src: 'src', settings: { version: '0.8.28' } }]);
    expect(mentionedAddresses(files)).toEqual([`0x${'ab'.repeat(20)}`]); // the precompile is skipped
  });
});

describe('badge', () => {
  it('is a self-contained SVG', () => {
    const svg = badgeSvg('exact', 'exact match');
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('#3550ff');
    expect(svg).not.toMatch(/href=|<script/);
  });
});
