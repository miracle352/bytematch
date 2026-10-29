// Gather a contract and everything it imports into a standard-JSON `sources` map, using
// the same source keys Hardhat and Foundry use, without running any project code.
//
//   project files: path relative to the project root    -> "contracts/Vault.sol"
//   packages:      the import path as written            -> "@openzeppelin/contracts/access/Ownable.sol"
//
// Keys matter: they are hashed into the contract metadata, so matching the original
// tool's keys is what turns a partial match into an exact one.

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

export interface CollectOptions {
  root: string;
  /** Foundry-style remappings, e.g. "@openzeppelin/=lib/openzeppelin-contracts/". */
  remappings?: string[];
  /** Directories searched for package imports, relative to root. Default: node_modules. */
  libraryDirs?: string[];
}

const IMPORT_RE = /^\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']\s*;/gm;

export function importsOf(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return [...noComments.matchAll(IMPORT_RE)].map((m) => m[1]!);
}

function applyRemappings(path: string, remappings: string[]): string | null {
  let best: { from: string; to: string } | null = null;
  for (const r of remappings) {
    const body = r.includes(':') ? r.slice(r.indexOf(':') + 1) : r; // drop context prefix
    const [from, to] = body.split('=') as [string, string | undefined];
    if (to !== undefined && path.startsWith(from) && (!best || from.length > best.from.length)) best = { from, to };
  }
  return best ? best.to + path.slice(best.from.length) : null;
}

export function collectSources(entries: string[], opts: CollectOptions): Record<string, { content: string }> {
  const { root, remappings = [], libraryDirs = ['node_modules'] } = opts;
  const out: Record<string, { content: string }> = {};
  const queue = entries.map((e) => posix.normalize(e));

  const read = (key: string): string => {
    // A key is either a project path or a package path; find the file that backs it.
    const remapped = applyRemappings(key, remappings);
    const candidates = [
      ...(remapped ? [join(root, remapped)] : []),
      join(root, key),
      ...libraryDirs.map((d) => join(root, d, key)),
    ];
    const file = candidates.find((c) => existsSync(c));
    if (!file) throw new Error(`cannot find ${key} (looked in ${candidates.join(', ')})`);
    return readFileSync(file, 'utf8');
  };

  while (queue.length) {
    const key = queue.shift()!;
    if (out[key]) continue;
    const content = read(key);
    out[key] = { content };
    for (const imp of importsOf(content)) {
      const next = imp.startsWith('.') ? posix.normalize(posix.join(posix.dirname(key), imp)) : imp;
      if (!out[next]) queue.push(next);
    }
  }
  return out;
}
