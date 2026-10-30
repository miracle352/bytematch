// Collect a contract and its imports from files the user picked, using the source keys
// the original tool would have used (they are hashed into metadata, so they decide
// exact vs partial):
//   Hardhat: project paths ("contracts/A.sol"), packages as imported ("@openzeppelin/...")
//   Foundry: paths after remapping ("lib/openzeppelin-contracts/contracts/...")
// Files are read lazily: a project folder can hold thousands of library files.

export interface PickedProject {
  files: Map<string, File>; // project-relative path -> file
  remappings: string[];
  foundry: boolean;
  /** .sol files that belong to the project itself (not libraries or tests). */
  own: string[];
}

const LIB_DIRS = ['node_modules/', 'lib/'];

export async function pickProject(list: FileList | File[]): Promise<PickedProject> {
  const all = [...list];
  // Folder picks prefix every path with the folder name; drop it.
  const rel = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  const top = all.length && rel(all[0]!).includes('/') ? rel(all[0]!).split('/')[0] + '/' : '';
  const files = new Map<string, File>();
  for (const f of all) {
    const p = rel(f).startsWith(top) ? rel(f).slice(top.length) : rel(f);
    if (p.endsWith('.sol') || p === 'remappings.txt' || p === 'foundry.toml') files.set(p, f);
  }
  const foundry = files.has('foundry.toml');
  const remappings: string[] = [];
  if (files.has('remappings.txt')) {
    for (const line of (await files.get('remappings.txt')!.text()).split('\n')) if (line.includes('=')) remappings.push(line.trim());
  }
  if (foundry) {
    const toml = await files.get('foundry.toml')!.text();
    const m = toml.match(/remappings\s*=\s*\[([\s\S]*?)\]/);
    if (m) for (const r of m[1]!.matchAll(/["']([^"']+=[^"']*)["']/g)) remappings.push(r[1]!);
  }
  const own = [...files.keys()]
    .filter((p) => p.endsWith('.sol'))
    .filter((p) => !LIB_DIRS.some((d) => p.startsWith(d) || p.includes(`/${d}`)))
    .filter((p) => !/(^|\/)(test|tests|script|mocks?)\//i.test(p) && !/\.t\.sol$|\.s\.sol$/.test(p))
    .sort();
  return { files, remappings, foundry, own };
}

const IMPORT_RE = /^\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']\s*;/gm;

function importsOf(src: string): string[] {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return [...clean.matchAll(IMPORT_RE)].map((m) => m[1]!);
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

function dirname(p: string) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function remap(path: string, remappings: string[]): string | null {
  let best: [string, string] | null = null;
  for (const r of remappings) {
    const body = r.includes(':') ? r.slice(r.indexOf(':') + 1) : r;
    const [from, to = ''] = body.split('=') as [string, string?];
    if (path.startsWith(from) && (!best || from.length > best[0].length)) best = [from, to];
  }
  return best ? normalize(best[1] + path.slice(best[0].length)) : null;
}

/** Sources for `entry` and everything it imports, keyed the way the build tool keys them. */
export async function collect(project: PickedProject, entry: string): Promise<Record<string, { content: string }>> {
  const out: Record<string, { content: string }> = {};
  const queue: Array<{ key: string; file: string }> = [{ key: entry, file: entry }];

  const locate = (imp: string, fromKey: string): { key: string; file: string } => {
    if (imp.startsWith('.')) {
      const key = normalize(`${dirname(fromKey)}/${imp}`);
      return { key, file: key };
    }
    const remapped = remap(imp, project.remappings);
    if (remapped && project.files.has(remapped)) return { key: project.foundry ? remapped : imp, file: remapped };
    if (project.files.has(imp)) return { key: imp, file: imp };
    const nm = `node_modules/${imp}`;
    if (project.files.has(nm)) return { key: imp, file: nm };
    throw new Error(
      `${fromKey} imports ${imp}, which isn't in the folder you picked. Pick the whole project, including node_modules or lib.`,
    );
  };

  while (queue.length) {
    const { key, file } = queue.shift()!;
    if (out[key]) continue;
    const f = project.files.get(file);
    if (!f) throw new Error(`Couldn't find ${file} in the picked files.`);
    const content = await f.text();
    out[key] = { content };
    for (const imp of importsOf(content)) queue.push(locate(imp, key));
  }
  return out;
}

/** Contract names declared in a source file, for the "which contract" picker. */
export function contractsIn(src: string): string[] {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return [...clean.matchAll(/^\s*(?:abstract\s+)?contract\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]!);
}
