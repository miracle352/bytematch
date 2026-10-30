// Persistence. Two backends behind one async interface:
//   SqliteStore - node:sqlite file, for local runs and any server with a disk
//   RedisStore  - Upstash Redis over its REST API, for serverless (Vercel) deploys
// openStore() picks Redis when its credentials are in the environment.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchLevel } from './bytecode.js';
import type { Bundle } from './bundle.js';

export interface ContractRecord {
  address: string;
  codeHash: string;
  level: MatchLevel;
  contractPath: string;
  contractName: string;
  compilerVersion: string;
  evmVersion: string | null;
  optimizer: { enabled: boolean; runs: number } | null;
  viaIR: boolean;
  abi: unknown[];
  constructorArgs: string | null;
  creationTx: string | null;
  deployer: string | null;
  deployBlock: number | null;
  libraries: Record<string, string>;
  digest: string;
  bundle: Bundle;
  verifiedAt: string;
  attestationTx: string | null;
}

export type JobStatus = 'pending' | 'pass' | 'fail';

export interface Job {
  id: string;
  address: string;
  status: JobStatus;
  message: string;
  createdAt: string;
}

export interface Store {
  /** Saves unless it would replace an exact match for the same code with a partial one. */
  saveContract(r: ContractRecord): Promise<boolean>;
  setAttestation(address: string, tx: string): Promise<void>;
  getContract(address: string): Promise<ContractRecord | null>;
  /** A verified contract with this runtime code hash, exact matches first. */
  findByCodeHash(codeHash: string): Promise<ContractRecord | null>;
  listContracts(limit?: number, offset?: number): Promise<ContractRecord[]>;
  countContracts(): Promise<{ total: number; exact: number }>;
  createJob(id: string, address: string): Promise<void>;
  finishJob(id: string, status: Exclude<JobStatus, 'pending'>, message: string): Promise<void>;
  getJob(id: string): Promise<Job | null>;
  /** Small JSON cache with expiry, used for the network index. */
  cacheGet<T>(key: string): Promise<T | null>;
  cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

function shouldReplace(prev: ContractRecord | null, next: ContractRecord): boolean {
  return !(prev && prev.codeHash === next.codeHash && prev.level === 'exact' && next.level === 'partial');
}

// ---------------------------------------------------------------------------------------

export class SqliteStore implements Store {
  // Typed loosely so this module loads where node:sqlite doesn't exist (it's imported lazily).
  private constructor(private readonly db: any) {}

  static async open(dataDir: string): Promise<SqliteStore> {
    // getBuiltinModule keeps bundlers (Vite, Vercel's) from trying to resolve node:sqlite.
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(join(dataDir, 'bytematch.db'));
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS contracts (
        address     TEXT PRIMARY KEY,
        code_hash   TEXT NOT NULL,
        level       TEXT NOT NULL,
        record      TEXT NOT NULL,
        verified_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contracts_code_hash ON contracts(code_hash);
      CREATE INDEX IF NOT EXISTS contracts_verified_at ON contracts(verified_at);
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, address TEXT NOT NULL, status TEXT NOT NULL,
        message TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
    `);
    return new SqliteStore(db);
  }

  async saveContract(r: ContractRecord) {
    if (!shouldReplace(await this.getContract(r.address), r)) return false;
    this.db
      .prepare(
        `INSERT INTO contracts (address, code_hash, level, record, verified_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET code_hash = excluded.code_hash, level = excluded.level,
           record = excluded.record, verified_at = excluded.verified_at`,
      )
      .run(r.address, r.codeHash, r.level, JSON.stringify(r), r.verifiedAt);
    return true;
  }

  async setAttestation(address: string, tx: string) {
    const r = await this.getContract(address);
    if (!r) return;
    r.attestationTx = tx;
    this.db.prepare('UPDATE contracts SET record = ? WHERE address = ?').run(JSON.stringify(r), address);
  }

  async getContract(address: string) {
    const row = this.db.prepare('SELECT record FROM contracts WHERE address = ?').get(address.toLowerCase());
    return row ? (JSON.parse(row.record) as ContractRecord) : null;
  }

  async findByCodeHash(codeHash: string) {
    const row = this.db
      .prepare(`SELECT record FROM contracts WHERE code_hash = ? ORDER BY level = 'exact' DESC, verified_at ASC LIMIT 1`)
      .get(codeHash);
    return row ? (JSON.parse(row.record) as ContractRecord) : null;
  }

  async listContracts(limit = 50, offset = 0) {
    const rows = this.db.prepare('SELECT record FROM contracts ORDER BY verified_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    return (rows as Array<{ record: string }>).map((r) => JSON.parse(r.record) as ContractRecord);
  }

  async countContracts() {
    const row = this.db.prepare(`SELECT COUNT(*) AS total, SUM(level = 'exact') AS exact FROM contracts`).get();
    return { total: Number(row.total), exact: Number(row.exact ?? 0) };
  }

  async createJob(id: string, address: string) {
    this.db
      .prepare('INSERT INTO jobs (id, address, status, message, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, address, 'pending', 'Pending in queue', new Date().toISOString());
  }

  async finishJob(id: string, status: Exclude<JobStatus, 'pending'>, message: string) {
    this.db.prepare('UPDATE jobs SET status = ?, message = ? WHERE id = ?').run(status, message, id);
  }

  async getJob(id: string) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return row ? { id: row.id, address: row.address, status: row.status, message: row.message, createdAt: row.created_at } : null;
  }

  async cacheGet<T>(key: string) {
    const row = this.db.prepare('SELECT value, expires FROM cache WHERE key = ?').get(key);
    return row && row.expires > Date.now() ? (JSON.parse(row.value) as T) : null;
  }

  async cacheSet(key: string, value: unknown, ttlSeconds: number) {
    this.db
      .prepare('INSERT INTO cache (key, value, expires) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires = excluded.expires')
      .run(key, JSON.stringify(value), Date.now() + ttlSeconds * 1000);
  }
}

// ---------------------------------------------------------------------------------------
// Keys:
//   bm:c:<address>    record JSON
//   bm:h:<codeHash>   hash address -> level
//   bm:recent         zset address scored by verification time
//   bm:job:<id>       job JSON, expires after a day
//   bm:cache:<key>    cache JSON with expiry

type Cmd = Array<string | number>;

export class RedisStore implements Store {
  constructor(private readonly url: string, private readonly token: string) {}

  private async pipeline(cmds: Cmd[]): Promise<unknown[]> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(cmds.map((c) => c.map(String))),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`redis: HTTP ${res.status}`);
    const out = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    return out.map((r) => {
      if (r.error) throw new Error(`redis: ${r.error}`);
      return r.result;
    });
  }

  private async one<T>(cmd: Cmd): Promise<T> {
    return (await this.pipeline([cmd]))[0] as T;
  }

  async saveContract(r: ContractRecord) {
    const prev = await this.getContract(r.address);
    if (!shouldReplace(prev, r)) return false;
    const cmds: Cmd[] = [
      ['SET', `bm:c:${r.address}`, JSON.stringify(r)],
      ['HSET', `bm:h:${r.codeHash}`, r.address, r.level],
      ['ZADD', 'bm:recent', Date.parse(r.verifiedAt), r.address],
    ];
    if (prev && prev.codeHash !== r.codeHash) cmds.push(['HDEL', `bm:h:${prev.codeHash}`, r.address]);
    await this.pipeline(cmds);
    return true;
  }

  async setAttestation(address: string, tx: string) {
    const r = await this.getContract(address);
    if (!r) return;
    r.attestationTx = tx;
    await this.one(['SET', `bm:c:${address}`, JSON.stringify(r)]);
  }

  async getContract(address: string) {
    const v = await this.one<string | null>(['GET', `bm:c:${address.toLowerCase()}`]);
    return v ? (JSON.parse(v) as ContractRecord) : null;
  }

  async findByCodeHash(codeHash: string) {
    const flat = (await this.one<string[]>(['HGETALL', `bm:h:${codeHash}`])) ?? [];
    const entries: Array<[string, string]> = [];
    for (let i = 0; i < flat.length; i += 2) entries.push([flat[i]!, flat[i + 1]!]);
    entries.sort((a, b) => Number(b[1] === 'exact') - Number(a[1] === 'exact'));
    for (const [address] of entries) {
      const r = await this.getContract(address);
      if (r && r.codeHash === codeHash) return r;
    }
    return null;
  }

  async listContracts(limit = 50, offset = 0) {
    const addrs = await this.one<string[]>(['ZRANGE', 'bm:recent', offset, offset + limit - 1, 'REV']);
    if (!addrs?.length) return [];
    const vals = await this.one<Array<string | null>>(['MGET', ...addrs.map((a) => `bm:c:${a}`)]);
    return vals.filter((v): v is string => !!v).map((v) => JSON.parse(v) as ContractRecord);
  }

  async countContracts() {
    const all = await this.listContracts(10_000);
    return { total: all.length, exact: all.filter((r) => r.level === 'exact').length };
  }

  async createJob(id: string, address: string) {
    const job: Job = { id, address, status: 'pending', message: 'Pending in queue', createdAt: new Date().toISOString() };
    await this.one(['SET', `bm:job:${id}`, JSON.stringify(job), 'EX', 86_400]);
  }

  async finishJob(id: string, status: Exclude<JobStatus, 'pending'>, message: string) {
    const job = await this.getJob(id);
    if (!job) return;
    await this.one(['SET', `bm:job:${id}`, JSON.stringify({ ...job, status, message }), 'EX', 86_400]);
  }

  async getJob(id: string) {
    const v = await this.one<string | null>(['GET', `bm:job:${id}`]);
    return v ? (JSON.parse(v) as Job) : null;
  }

  async cacheGet<T>(key: string) {
    const v = await this.one<string | null>(['GET', `bm:cache:${key}`]);
    return v ? (JSON.parse(v) as T) : null;
  }

  async cacheSet(key: string, value: unknown, ttlSeconds: number) {
    await this.one(['SET', `bm:cache:${key}`, JSON.stringify(value), 'EX', ttlSeconds]);
  }
}

export async function openStore(dataDir: string): Promise<Store> {
  // Vercel's Upstash integration sets KV_REST_API_*; Upstash's own console uses UPSTASH_REDIS_REST_*.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisStore(url, token);
  return SqliteStore.open(dataDir);
}
