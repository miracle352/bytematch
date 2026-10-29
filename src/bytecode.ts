// Comparing compiled bytecode with deployed bytecode.
//
// A straight string compare is wrong in four common cases, each handled here:
//
// 1. Metadata. solc appends a CBOR blob (the "auxdata") to every contract: an IPFS hash
//    of the metadata JSON plus the compiler version. The hash covers the exact source
//    text, file paths and settings, so a comment change alters it while the executable
//    code stays identical. If everything including the auxdata matches we call it an
//    EXACT match. If only the auxdata differs we call it PARTIAL: same code, but we
//    cannot prove the source text is byte-for-byte what was deployed.
// 2. Immutables. `immutable` values are written into the runtime code by the
//    constructor; the compiler leaves zeros there. We copy the deployed bytes in.
// 3. Linked libraries. Placeholders like __$abcd…$__ get replaced by addresses at link
//    time. We copy the deployed addresses in and report them.
// 4. Libraries themselves start with PUSH20 <own address>, written at deploy time.

export type Hex = string; // lowercase, no 0x prefix

export function strip0x(h: string): Hex {
  return (h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h).toLowerCase();
}

export interface Range {
  start: number; // byte offset
  length: number; // bytes
}

// ---------------------------------------------------------------------------------------
// Auxdata (CBOR) location and decoding

// Keys solc has used: "ipfs", "bzzr0", "bzzr1", "solc", "experimental".
const AUX_ENTRY =
  '(?:64697066735822[0-9a-f]{68}' + // "ipfs" => bytes(34)
  '|65627a7a72(?:30|31)5820[0-9a-f]{64}' + // "bzzr0"/"bzzr1" => bytes(32)
  '|64736f6c6343[0-9a-f]{6}' + // "solc" => bytes(3)
  '|6c6578706572696d656e74616c(?:f4|f5))'; // "experimental" => bool
const AUX_RE = new RegExp(`a[1-4]${AUX_ENTRY}+`, 'g');

/** Every auxdata blob in the code, including ones embedded for `new Child()` creation. */
export function findAuxdata(code: Hex): Range[] {
  const out: Range[] = [];
  for (const m of code.matchAll(AUX_RE)) {
    const startChar = m.index!;
    if (startChar % 2 !== 0) continue; // must sit on a byte boundary
    const cborBytes = m[0].length / 2;
    const lenHex = code.slice(startChar + m[0].length, startChar + m[0].length + 4);
    if (lenHex.length === 4 && parseInt(lenHex, 16) === cborBytes) {
      out.push({ start: startChar / 2, length: cborBytes + 2 });
    }
  }
  return out;
}

export interface Auxdata {
  solc?: string; // "0.8.28" for releases, raw string for prereleases
  ipfs?: string; // CIDv0, base58
  bzzr?: string;
  experimental?: boolean;
}

/** Decode the trailing auxdata, if the code ends with one. */
export function decodeTrailingAuxdata(code: Hex): Auxdata | null {
  if (code.length < 4) return null;
  const len = parseInt(code.slice(-4), 16);
  if (!len || len * 2 + 4 > code.length) return null;
  const cbor = Buffer.from(code.slice(-(len * 2 + 4), -4), 'hex');
  try {
    const { value, end } = readCbor(cbor, 0);
    if (end !== cbor.length || !(value instanceof Map)) return null;
    const aux: Auxdata = {};
    for (const [k, v] of value) {
      if (k === 'solc') aux.solc = v instanceof Uint8Array ? Array.from(v).join('.') : String(v);
      else if (k === 'ipfs' && v instanceof Uint8Array) aux.ipfs = base58(v);
      else if ((k === 'bzzr0' || k === 'bzzr1') && v instanceof Uint8Array) aux.bzzr = Buffer.from(v).toString('hex');
      else if (k === 'experimental') aux.experimental = v === true;
    }
    return aux;
  } catch {
    return null;
  }
}

// Just enough CBOR for solc auxdata: maps, text, bytes, booleans.
function readCbor(buf: Buffer, pos: number): { value: unknown; end: number } {
  const head = buf[pos];
  if (head === undefined) throw new Error('cbor: eof');
  const major = head >> 5;
  const info = head & 0x1f;
  let p = pos + 1;
  let n: number;
  if (info < 24) n = info;
  else if (info === 24) n = buf.readUInt8(p++);
  else if (info === 25) { n = buf.readUInt16BE(p); p += 2; }
  else if (major === 7) n = info;
  else throw new Error('cbor: unsupported length');

  switch (major) {
    case 2: return { value: new Uint8Array(buf.subarray(p, p + n)), end: p + n };
    case 3: return { value: buf.subarray(p, p + n).toString('utf8'), end: p + n };
    case 5: {
      const map = new Map<unknown, unknown>();
      for (let i = 0; i < n; i++) {
        const k = readCbor(buf, p);
        const v = readCbor(buf, k.end);
        map.set(k.value, v.value);
        p = v.end;
      }
      return { value: map, end: p };
    }
    case 7:
      if (info === 20) return { value: false, end: p };
      if (info === 21) return { value: true, end: p };
      throw new Error('cbor: unsupported simple value');
    default:
      throw new Error(`cbor: unsupported major type ${major}`);
  }
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'));
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
}

// ---------------------------------------------------------------------------------------
// Normalising compiled code against deployed code

export type LinkReferences = Record<string, Record<string, Range[]>>;
export type ImmutableReferences = Record<string, Range[]>;

export interface Normalised {
  code: Hex;
  libraries: Record<string, string>; // "file:Lib" -> 0xaddress
  immutables: Record<string, string>; // astId -> 0xvalue
}

function splice(code: Hex, r: Range, from: Hex): Hex {
  const a = r.start * 2;
  const b = a + r.length * 2;
  return code.slice(0, a) + from.slice(a, b) + code.slice(b);
}

/** Copy library addresses and immutable values from `deployed` into `compiled`. */
export function normalise(
  compiled: Hex,
  deployed: Hex,
  linkReferences: LinkReferences = {},
  immutableReferences: ImmutableReferences = {},
): Normalised {
  let code = compiled;
  const libraries: Record<string, string> = {};
  const immutables: Record<string, string> = {};

  for (const [file, libs] of Object.entries(linkReferences)) {
    for (const [lib, ranges] of Object.entries(libs)) {
      for (const r of ranges) {
        code = splice(code, r, deployed);
        libraries[`${file}:${lib}`] = '0x' + deployed.slice(r.start * 2, (r.start + r.length) * 2);
      }
    }
  }

  for (const [id, ranges] of Object.entries(immutableReferences)) {
    for (const r of ranges) {
      code = splice(code, r, deployed);
      immutables[id] = '0x' + deployed.slice(r.start * 2, (r.start + r.length) * 2);
    }
  }

  // Library runtime code: PUSH20 <zero address> ADDRESS EQ, address filled in at deploy.
  const LIB_PREFIX = '73' + '00'.repeat(20);
  if (code.startsWith(LIB_PREFIX) && deployed.startsWith('73') && deployed.length >= LIB_PREFIX.length) {
    code = deployed.slice(0, LIB_PREFIX.length) + code.slice(LIB_PREFIX.length);
  }

  return { code, libraries, immutables };
}

export type MatchLevel = 'exact' | 'partial';

/**
 * Compare normalised compiled code with deployed code.
 * exact: identical, metadata included. partial: identical once every auxdata blob in the
 * compiled code is masked out of both sides.
 */
export function compareCode(compiled: Hex, deployed: Hex): MatchLevel | null {
  if (compiled === deployed) return 'exact';
  if (compiled.length !== deployed.length) return null;
  let masked = deployed;
  for (const r of findAuxdata(compiled)) masked = splice(masked, r, compiled);
  return masked === compiled ? 'partial' : null;
}

export interface RuntimeMatch extends Normalised {
  level: MatchLevel;
}

export function matchRuntime(
  compiled: Hex,
  deployed: Hex,
  linkReferences?: LinkReferences,
  immutableReferences?: ImmutableReferences,
): RuntimeMatch | null {
  if (!compiled) return null; // interfaces and abstract contracts have no code
  const n = normalise(compiled, deployed, linkReferences, immutableReferences);
  const level = compareCode(n.code, deployed);
  return level ? { ...n, level } : null;
}

export interface CreationMatch {
  level: MatchLevel;
  constructorArgs: Hex; // ABI-encoded, may be empty
}

/** Match a deploy transaction's input against compiled creation code. */
export function matchCreation(
  compiled: Hex,
  txInput: Hex,
  linkReferences: LinkReferences = {},
): CreationMatch | null {
  if (!compiled || txInput.length < compiled.length) return null;
  const head = txInput.slice(0, compiled.length);
  const { code } = normalise(compiled, head, linkReferences, {});
  const level = compareCode(code, head);
  return level ? { level, constructorArgs: txInput.slice(compiled.length) } : null;
}

/** True for PolkaVM blobs, which pallet-revive stores with a "PVM\0" magic prefix. */
export function isPolkaVm(code: Hex): boolean {
  return code.startsWith('50564d00');
}
