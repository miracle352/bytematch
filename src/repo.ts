// Verify a whole repository: find the contracts it deployed and match them to its source.
//
// Nothing from the repository is executed. Config files are read as text, imports are
// resolved by the same rules Hardhat and Foundry use, and dependencies come from the
// public registries at the versions the repository pins:
//   npm packages   jsDelivr, at the version in package-lock.json (or package.json)
//   git submodules raw.githubusercontent.com, at the commit the repository records

import { gunzipSync } from 'node:zlib';
import { posix } from 'node:path';
import { keccak256 } from 'ethers';
import type { Chain } from './chain.js';
import { decodeTrailingAuxdata, isPolkaVm, matchRuntime, strip0x } from './bytecode.js';
import { compile, compileErrors, defaultEvmVersion, resolveVersion, type StandardJsonInput } from './compiler.js';
import { importsOf } from './collect.js';

export interface RepoRef {
  owner: string;
  repo: string;
  ref: string; // branch, tag or commit; HEAD for the default branch
}

export function parseRepoUrl(input: string): RepoRef {
  const s = input.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/(.+))?$/i) ?? s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) throw new Error(`${input} is not a GitHub repository. Use https://github.com/owner/repo.`);
  return { owner: m[1]!, repo: m[2]!, ref: m[3] ?? 'HEAD' };
}

// ---------------------------------------------------------------------------------------
// Fetching

export interface Fetcher {
  /** The repository as a gzipped tarball (GitHub's archive format). */
  tarball(r: RepoRef): Promise<Buffer>;
  /** The commit a submodule path is pinned to. */
  submoduleSha(r: RepoRef, path: string): Promise<string | null>;
  /** A file from another GitHub repository at a commit. */
  raw(owner: string, repo: string, sha: string, path: string): Promise<string | null>;
  /** A file from an npm package. */
  npm(pkg: string, version: string, path: string): Promise<string | null>;
}

async function get(url: string, headers: Record<string, string> = {}): Promise<Response | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'bytematch', ...headers }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return null;
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 429) return null;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return null;
}

export function httpFetcher(githubToken = process.env.GITHUB_TOKEN): Fetcher {
  const api: Record<string, string> = githubToken ? { authorization: `Bearer ${githubToken}` } : {};
  return {
    async tarball(r) {
      const res = await get(`https://codeload.github.com/${r.owner}/${r.repo}/tar.gz/${r.ref}`);
      if (!res) throw new Error(`couldn't download ${r.owner}/${r.repo}. Is it public?`);
      return Buffer.from(await res.arrayBuffer());
    },
    async submoduleSha(r, path) {
      const res = await get(`https://api.github.com/repos/${r.owner}/${r.repo}/contents/${path}?ref=${r.ref}`, api);
      const j = res ? ((await res.json()) as { type?: string; sha?: string }) : null;
      return j?.type === 'submodule' && j.sha ? j.sha : null;
    },
    async raw(owner, repo, sha, path) {
      const res = await get(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`);
      return res ? res.text() : null;
    },
    async npm(pkg, version, path) {
      const res = await get(`https://cdn.jsdelivr.net/npm/${pkg}@${version}/${path}`);
      return res ? res.text() : null;
    },
  };
}

// ---------------------------------------------------------------------------------------
// Tarballs (ustar with pax headers, as GitHub produces them)

const KEEP = /\.(sol|json|toml|md|txt|ts|tsx|js|jsx|mjs|cjs|ya?ml|env\.example)$|(^|\/)(\.gitmodules|remappings\.txt)$/;
const SKIP_DIR = /(^|\/)(node_modules|\.git|cache|out|artifacts|typechain-types|coverage|dist|build)\//;

export function untar(gz: Buffer, maxFileBytes = 1_500_000): Map<string, string> {
  const tar = gunzipSync(gz);
  const files = new Map<string, string>();
  let pos = 0;
  let longName: string | null = null;
  let top: string | null = null;
  while (pos + 512 <= tar.length) {
    const header = tar.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break;
    const str = (a: number, b: number) => header.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(header[156]!);
    const prefix = str(345, 500);
    let name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = null;
    const body = tar.subarray(pos + 512, pos + 512 + size);
    pos += 512 + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      const m = body.toString('utf8').match(/\d+ path=([^\n]+)\n/);
      if (m) longName = m[1]!;
      continue;
    }
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if (type !== '0' && type !== '\0') continue;
    top ??= name.split('/')[0]!;
    if (name.startsWith(`${top}/`)) name = name.slice(top.length + 1);
    if (!KEEP.test(name) || SKIP_DIR.test(name) || size > maxFileBytes) continue;
    if (/(^|\/)(package-lock|yarn\.lock|pnpm-lock)/.test(name) && !name.endsWith('package-lock.json')) continue;
    files.set(name, body.toString('utf8'));
  }
  return files;
}

// ---------------------------------------------------------------------------------------
// Projects and their settings, read as text

export interface Settings {
  version?: string;
  optimizer?: { enabled: boolean; runs: number };
  viaIR?: boolean;
  evmVersion?: string;
  bytecodeHash?: 'ipfs' | 'bzzr1' | 'none';
  appendCBOR?: boolean;
}

export interface Project {
  root: string; // '' for the repository root
  tool: 'foundry' | 'hardhat' | 'plain';
  src: string; // source directory, relative to root
  settings: Settings;
  remappings: string[];
}

/** The subset of TOML that foundry.toml uses: sections, scalars and arrays of strings. */
export function parseFoundryToml(text: string): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  let section = '';
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      section = sec[1]!.trim();
      continue;
    }
    const kv = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2]!;
    if (value.startsWith('[') && !value.includes(']')) {
      while (++i < lines.length && !lines[i]!.includes(']')) value += lines[i]!.replace(/#.*$/, '');
      value += lines[i] ?? ']';
    }
    let parsed: unknown;
    if (value.startsWith('[')) parsed = [...value.matchAll(/["']([^"']*)["']/g)].map((m) => m[1]);
    else if (/^["']/.test(value)) parsed = value.replace(/^["']|["']$/g, '');
    else if (value === 'true' || value === 'false') parsed = value === 'true';
    else if (/^\d+$/.test(value.replace(/_/g, ''))) parsed = Number(value.replace(/_/g, ''));
    else parsed = value;
    (out[section] ??= {})[kv[1]!] = parsed;
  }
  return { ...(out[''] ?? {}), ...(out['profile.default'] ?? {}) };
}

function foundrySettings(toml: Record<string, unknown>): { settings: Settings; src: string; remappings: string[] } {
  const enabled = toml.optimizer === true;
  const settings: Settings = {
    version: (toml.solc_version ?? toml.solc) as string | undefined,
    optimizer: { enabled, runs: Number(toml.optimizer_runs ?? 200) },
    viaIR: toml.via_ir === true,
    evmVersion: toml.evm_version as string | undefined,
    bytecodeHash: (toml.bytecode_hash as Settings['bytecodeHash']) ?? 'ipfs',
    appendCBOR: toml.cbor_metadata === false ? false : undefined,
  };
  return { settings, src: (toml.src as string) ?? 'src', remappings: (toml.remappings as string[]) ?? [] };
}

/** Values from a Hardhat config, found by pattern; the file is never run. */
export function hardhatSettings(text: string): { settings: Settings; src: string } {
  const pick = (re: RegExp) => text.match(re)?.[1];
  const version = pick(/version\s*:\s*["'`](\d+\.\d+\.\d+)/) ?? pick(/solidity\s*:\s*["'`](\d+\.\d+\.\d+)/);
  const enabled = pick(/optimizer\s*:\s*\{[^}]*enabled\s*:\s*(true|false)/s);
  const runs = pick(/runs\s*:\s*([\d_]+)/);
  return {
    settings: {
      version,
      optimizer: { enabled: enabled === 'true', runs: runs ? Number(runs.replace(/_/g, '')) : 200 },
      viaIR: pick(/viaIR\s*:\s*(true|false)/) === 'true',
      evmVersion: pick(/evmVersion\s*:\s*["'`](\w+)/),
      bytecodeHash: pick(/bytecodeHash\s*:\s*["'`](\w+)/) as Settings['bytecodeHash'],
    },
    src: pick(/sources\s*:\s*["'`]\.?\/?([\w./-]+)/) ?? 'contracts',
  };
}

export function findProjects(files: Map<string, string>): Project[] {
  const projects: Project[] = [];
  for (const [path, text] of files) {
    const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path);
    if (SKIP_DIR.test(`${path}/`) || /(^|\/)lib\//.test(path)) continue;
    if (path.endsWith('foundry.toml')) {
      const f = foundrySettings(parseFoundryToml(text));
      const extra = files.get(posix.join(dir, 'remappings.txt'));
      const remappings = [...f.remappings, ...(extra ? extra.split('\n').map((l) => l.trim()).filter((l) => l.includes('=')) : [])];
      projects.push({ root: dir, tool: 'foundry', src: f.src, settings: f.settings, remappings });
    } else if (/(^|\/)hardhat\.config\.(js|ts|cjs|mjs)$/.test(path)) {
      const h = hardhatSettings(text);
      projects.push({ root: dir, tool: 'hardhat', src: h.src, settings: h.settings, remappings: [] });
    }
  }
  if (!projects.length && [...files.keys()].some((p) => p.endsWith('.sol'))) {
    const dir = [...files.keys()].find((p) => p.endsWith('.sol'))!.split('/').slice(0, -1).join('/');
    projects.push({ root: '', tool: 'plain', src: dir, settings: {}, remappings: [] });
  }
  return projects;
}

// ---------------------------------------------------------------------------------------
// Sources and dependencies

const join = (...p: string[]) => posix.normalize(posix.join(...p)).replace(/^\.\//, '').replace(/^\.$/, '');

function npmPackageOf(imp: string): { pkg: string; sub: string } {
  const parts = imp.split('/');
  const n = imp.startsWith('@') ? 2 : 1;
  return { pkg: parts.slice(0, n).join('/'), sub: parts.slice(n).join('/') };
}

function remap(path: string, remappings: string[]): string | null {
  let best: [string, string] | null = null;
  for (const r of remappings) {
    const body = r.includes(':') ? r.slice(r.indexOf(':') + 1) : r;
    const [from, to = ''] = body.split('=') as [string, string?];
    if (from && path.startsWith(from) && (!best || from.length > best[0].length)) best = [from, to];
  }
  return best ? posix.normalize(best[1] + path.slice(best[0].length)) : null;
}

export class SourceResolver {
  private versions = new Map<string, string>();
  private submodules = new Map<string, { owner: string; repo: string; sha: Promise<string | null> | null }>();
  private cache = new Map<string, string | null>();

  constructor(
    private readonly files: Map<string, string>,
    private readonly project: Project,
    private readonly ref: RepoRef,
    private readonly fetcher: Fetcher,
  ) {
    const lock = files.get(join(project.root, 'package-lock.json')) ?? files.get('package-lock.json');
    if (lock) {
      try {
        const j = JSON.parse(lock) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
        for (const [k, v] of Object.entries(j.packages ?? {})) if (k.startsWith('node_modules/') && v.version) this.versions.set(k.slice(13), v.version);
        for (const [k, v] of Object.entries(j.dependencies ?? {})) if (v.version && !this.versions.has(k)) this.versions.set(k, v.version);
      } catch {
        /* ignore a broken lockfile */
      }
    }
    for (const pj of [join(project.root, 'package.json'), 'package.json']) {
      try {
        const j = JSON.parse(files.get(pj) ?? '{}') as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        for (const [k, v] of Object.entries({ ...j.devDependencies, ...j.dependencies })) {
          const exact = v.replace(/^[\^~>=<\s]+/, '').split(/\s/)[0]!;
          if (!this.versions.has(k) && /^\d/.test(exact)) this.versions.set(k, exact);
        }
      } catch {
        /* ignore */
      }
    }
    const gm = files.get('.gitmodules') ?? '';
    for (const block of gm.split('[submodule').slice(1)) {
      const path = block.match(/path\s*=\s*(\S+)/)?.[1];
      const url = block.match(/url\s*=\s*(\S+)/)?.[1];
      const m = url?.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
      if (path && m) this.submodules.set(path, { owner: m[1]!, repo: m[2]!, sha: null });
    }
  }

  get foundryRemappings(): string[] {
    const r = [...this.project.remappings];
    const has = (prefix: string) => r.some((x) => x.startsWith(prefix));
    const lib = join(this.project.root, 'lib');
    for (const sub of this.submodules.keys()) {
      if (!sub.startsWith(`${lib}/`)) continue;
      const name = sub.slice(lib.length + 1);
      const rel = posix.relative(this.project.root || '.', sub);
      if (name === 'openzeppelin-contracts' && !has('@openzeppelin/contracts/')) r.push(`@openzeppelin/contracts/=${rel}/contracts/`);
      if (name === 'openzeppelin-contracts-upgradeable' && !has('@openzeppelin/contracts-upgradeable/')) r.push(`@openzeppelin/contracts-upgradeable/=${rel}/contracts/`);
      if (!has(`${name}/`)) r.push(`${name}/=${rel}/${name === 'forge-std' ? 'src/' : ''}`);
    }
    if (!has('@openzeppelin/') && this.versions.has('@openzeppelin/contracts')) r.push('@openzeppelin/=node_modules/@openzeppelin/');
    return r;
  }

  /** Read a file given its path relative to the project root. */
  private async readProjectFile(rel: string): Promise<string | null> {
    const repoPath = join(this.project.root, rel);
    if (this.files.has(repoPath)) return this.files.get(repoPath)!;
    if (this.cache.has(repoPath)) return this.cache.get(repoPath)!;
    let text: string | null = null;
    const nm = rel.match(/^node_modules\/(.+)$/);
    if (nm) {
      const { pkg, sub } = npmPackageOf(nm[1]!);
      text = await this.fetcher.npm(pkg, this.versions.get(pkg) ?? 'latest', sub);
    } else {
      for (const [subPath, s] of this.submodules) {
        if (!repoPath.startsWith(`${subPath}/`)) continue;
        s.sha ??= this.fetcher.submoduleSha(this.ref, subPath);
        text = await this.fetcher.raw(s.owner, s.repo, (await s.sha) ?? 'HEAD', repoPath.slice(subPath.length + 1));
        break;
      }
    }
    this.cache.set(repoPath, text);
    return text;
  }

  /** Map an import to its source key and the file behind it, the way the build tool would. */
  private async locate(imp: string, fromKey: string): Promise<{ key: string; text: string } | null> {
    if (imp.startsWith('.')) {
      const key = join(posix.dirname(fromKey), imp);
      const text = (await this.readProjectFile(key)) ?? (this.project.tool !== 'foundry' ? await this.readProjectFile(`node_modules/${key}`) : null);
      return text === null ? null : { key, text };
    }
    if (this.project.tool === 'foundry') {
      const target = remap(imp, this.foundryRemappings) ?? imp;
      const text = await this.readProjectFile(target);
      return text === null ? null : { key: target, text };
    }
    // Hardhat and plain projects: project path if it exists, else an npm package. Keys stay as imported.
    const local = await this.readProjectFile(imp);
    if (local !== null) return { key: imp, text: local };
    const pkg = await this.readProjectFile(`node_modules/${imp}`);
    return pkg === null ? null : { key: imp, text: pkg };
  }

  async collect(entries: string[]): Promise<{ sources: Record<string, { content: string }>; missing: string[] }> {
    const sources: Record<string, { content: string }> = {};
    const missing: string[] = [];
    const queue: Array<{ key: string; text: string }> = [];
    for (const e of entries) {
      const text = await this.readProjectFile(e);
      if (text !== null) queue.push({ key: e, text });
    }
    while (queue.length) {
      const batch = queue.splice(0, queue.length).filter((q) => !sources[q.key]);
      for (const q of batch) sources[q.key] = { content: q.text };
      const next = await Promise.all(
        batch.flatMap((q) =>
          importsOf(q.text).map(async (imp) => {
            const hit = await this.locate(imp, q.key);
            if (!hit) missing.push(`${imp} (from ${q.key})`);
            return hit;
          }),
        ),
      );
      for (const n of next) if (n && !sources[n.key]) queue.push(n);
    }
    return { sources, missing };
  }
}

/** The project's own contract files: its source directory, without tests and scripts. */
export function entryFiles(files: Map<string, string>, p: Project): string[] {
  const base = join(p.root, p.src);
  return [...files.keys()]
    .filter((f) => f.endsWith('.sol') && (base ? f.startsWith(`${base}/`) : true))
    .filter((f) => !/\.(t|s)\.sol$/.test(f) && !/(^|\/)(test|tests|script|scripts|lib|node_modules)\//.test(f.slice(base.length)))
    .map((f) => (p.root ? f.slice(p.root.length + 1) : f));
}

// ---------------------------------------------------------------------------------------
// Addresses the repository mentions

const ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const TEXT_FOR_ADDRESSES = /\.(md|json|toml|txt|ts|tsx|js|jsx|mjs|cjs|ya?ml|env\.example)$/;

export function mentionedAddresses(files: Map<string, string>, limit = 120): string[] {
  const counts = new Map<string, number>();
  for (const [path, text] of files) {
    if (!TEXT_FOR_ADDRESSES.test(path) || /package-lock\.json$|\.sol$/.test(path)) continue;
    // Deployment records first: broadcast logs, hardhat-deploy, deployments/*.json
    const weight = /(broadcast|deployments?|addresses)/i.test(path) ? 5 : /readme/i.test(path) ? 3 : 1;
    for (const m of text.matchAll(ADDRESS_RE)) {
      const a = m[0].toLowerCase();
      // Zero address, and the runtime's precompiles (pallet-assets and friends live at
      // addresses like 0x00000002…00010000); no real deployment has a run of 16 zeros.
      if (/0{16}/.test(a.slice(2))) continue;
      counts.set(a, (counts.get(a) ?? 0) + weight);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([a]) => a);
}

// ---------------------------------------------------------------------------------------
// Matching

export interface RepoMatch {
  address: string;
  contract: string; // "path:Name"
  level: 'exact' | 'partial';
  compilerVersion: string;
  input: StandardJsonInput;
}

export interface RepoContract {
  address: string;
  size: number;
  codeHash: string;
  status: 'exact' | 'partial' | 'no_match' | 'polkavm';
  name: string | null;
}

export interface RepoReport {
  repo: string; // owner/repo
  ref: string;
  url: string;
  scannedAt: string;
  projects: Array<{ root: string; tool: Project['tool']; sources: number; compiler: string | null; problem: string | null }>;
  mentioned: number;
  /** The settings search hit its time budget; unmatched contracts may match under settings not tried. */
  incomplete?: boolean;
  contracts: RepoContract[];
}

function settingsVariants(p: Project, version: string, aux: ReturnType<typeof decodeTrailingAuxdata>): StandardJsonInput['settings'][] {
  // Bytecode built with bytecodeHash "none" still ends in CBOR, holding only the solc version.
  const bytecodeHash = aux ? (aux.ipfs ? 'ipfs' : aux.bzzr ? 'bzzr1' : 'none') : (p.settings.bytecodeHash ?? 'none');
  const metadata: Record<string, unknown> = { bytecodeHash };
  if (!aux && p.settings.appendCBOR === false) metadata.appendCBOR = false;
  const base = {
    optimizer: p.settings.optimizer ?? { enabled: false, runs: 200 },
    viaIR: p.settings.viaIR ?? false,
    evmVersion: p.settings.evmVersion ?? defaultEvmVersion(version),
  };
  // Every combination of a few common values, nearest to what the config says first.
  // A readable config almost always matches on the first try; projects without one
  // (custom build scripts) get a wider search.
  const evms = [...new Set([base.evmVersion, 'paris', 'cancun', 'shanghai', 'london'])];
  const opts = [base.optimizer, { enabled: true, runs: 200 }, { enabled: false, runs: 200 }, { enabled: true, runs: 1 }, { enabled: true, runs: 1000 }]
    .filter((o, i, a) => a.findIndex((x) => x.enabled === o.enabled && (!o.enabled || x.runs === o.runs)) === i);
  const vias = [base.viaIR, !base.viaIR];
  const all: Array<{ s: NonNullable<StandardJsonInput['settings']>; d: number }> = [];
  for (const evmVersion of evms)
    for (const optimizer of opts)
      for (const viaIR of vias) {
        const d = Number(evmVersion !== base.evmVersion) + Number(optimizer !== base.optimizer) + Number(viaIR !== base.viaIR);
        all.push({ s: { optimizer, viaIR, evmVersion, metadata }, d });
      }
  all.sort((a, b) => a.d - b.d);
  return all.slice(0, p.tool === 'plain' ? 50 : 12).map((x) => x.s);
}

export async function scanRepository(
  chain: Chain,
  url: string,
  fetcher: Fetcher = httpFetcher(),
  log: (msg: string) => void = () => {},
  budgetMs = 190_000,
): Promise<{ report: RepoReport; matches: RepoMatch[] }> {
  // Stop searching settings at the budget and report what was found, so one large
  // repository can't run past the hosting time limit.
  const deadline = Date.now() + budgetMs;
  let outOfTime = false;
  const ref = parseRepoUrl(url);
  const files = untar(await fetcher.tarball(ref));
  log(`${ref.owner}/${ref.repo}: ${files.size} files`);

  // Which mentioned addresses are contracts on this chain?
  const mentioned = mentionedAddresses(files);
  const onChain: Array<{ address: string; code: string }> = [];
  for (let i = 0; i < mentioned.length; i += 6) {
    const codes = await Promise.all(mentioned.slice(i, i + 6).map((a) => chain.getCode(a).catch(() => '0x')));
    codes.forEach((c, j) => strip0x(c) && onChain.push({ address: mentioned[i + j]!, code: strip0x(c) }));
  }
  log(`${mentioned.length} addresses mentioned, ${onChain.length} are contracts`);

  const results = new Map<string, RepoContract>(
    onChain.map((c) => [
      c.address,
      { address: c.address, size: c.code.length / 2, codeHash: keccak256('0x' + c.code), status: isPolkaVm(c.code) ? 'polkavm' : 'no_match', name: null },
    ]),
  );
  const matches: RepoMatch[] = [];
  const projectsOut: RepoReport['projects'] = [];

  for (const project of findProjects(files)) {
    if (Date.now() > deadline) {
      outOfTime = true;
      break;
    }
    const resolver = new SourceResolver(files, project, ref, fetcher);
    const entries = entryFiles(files, project);
    const { sources, missing } = await resolver.collect(entries);
    const summary = { root: project.root, tool: project.tool, sources: Object.keys(sources).length, compiler: null as string | null, problem: null as string | null };
    projectsOut.push(summary);
    if (!entries.length) {
      summary.problem = 'no contract sources found';
      continue;
    }
    if (missing.length) summary.problem = `missing imports: ${missing.slice(0, 3).join(', ')}`;

    // Group the unmatched EVM contracts by the compiler and metadata mode their bytecode
    // records: contracts in one repository can be built differently.
    const pending = onChain.filter((c) => results.get(c.address)!.status === 'no_match');
    const groups = new Map<string, typeof pending>();
    for (const c of pending) {
      const aux = decodeTrailingAuxdata(c.code);
      const v = aux?.solc ?? project.settings.version;
      if (!v) continue;
      const key = `${v}|${aux ? (aux.ipfs ? 'ipfs' : aux.bzzr ? 'bzzr' : 'none') : 'nocbor'}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
    }

    for (const [key, group] of groups) {
      if (outOfTime) break;
      const version = key.split('|')[0]!;
      let longVersion: string;
      try {
        longVersion = await resolveVersion(version);
      } catch {
        continue;
      }
      summary.compiler ??= longVersion;
      const aux = decodeTrailingAuxdata(group[0]!.code);
      // Once some contract matches, the settings are known; anything left over differs
      // from the source, so give it only a couple more tries.
      let triesAfterHit = Infinity;
      for (const settings of settingsVariants(project, version, aux)) {
        const left = group.filter((c) => results.get(c.address)!.status === 'no_match');
        if (!left.length || triesAfterHit-- <= 0) break;
        if (Date.now() > deadline) {
          outOfTime = true;
          break;
        }
        const input: StandardJsonInput = {
          language: 'Solidity',
          sources,
          settings: project.tool === 'foundry' ? { ...settings, remappings: resolver.foundryRemappings } : settings,
        };
        const out = await compile(longVersion, input).catch(() => null);
        if (!out) continue;
        const errors = compileErrors(out);
        if (errors.length) {
          summary.problem ??= errors[0]!.split('\n')[0]!.slice(0, 160);
          if (Object.keys(out.contracts ?? {}).length === 0) break; // same sources fail under any settings
          continue;
        }
        for (const c of left) {
          for (const [path, byName] of Object.entries(out.contracts ?? {})) {
            for (const [name, cc] of Object.entries(byName)) {
              const d = cc.evm?.deployedBytecode;
              if (!d?.object) continue;
              const m = matchRuntime(d.object, c.code, d.linkReferences, d.immutableReferences);
              if (!m) continue;
              const r = results.get(c.address)!;
              if (r.status === 'exact') continue;
              if (project.tool !== 'plain') triesAfterHit = Math.min(triesAfterHit, 2);
              r.status = m.level;
              r.name = name;
              const existing = matches.findIndex((x) => x.address === c.address);
              const match = { address: c.address, contract: `${path}:${name}`, level: m.level, compilerVersion: longVersion, input };
              if (existing >= 0) matches[existing] = match;
              else matches.push(match);
            }
          }
        }
      }
    }
  }

  const report: RepoReport = {
    repo: `${ref.owner}/${ref.repo}`,
    ref: ref.ref,
    url: `https://github.com/${ref.owner}/${ref.repo}`,
    scannedAt: new Date().toISOString(),
    projects: projectsOut,
    mentioned: mentioned.length,
    ...(outOfTime ? { incomplete: true } : {}),
    contracts: [...results.values()].sort((a, b) => Number(b.status !== 'no_match') - Number(a.status !== 'no_match')),
  };
  log(`${matches.length} matched`);
  return { report, matches };
}
