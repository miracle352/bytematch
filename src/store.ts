// SQLite persistence (node:sqlite, no native build step).

import { DatabaseSync } from 'node:sqlite';
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

export class Store {
  readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'sourcebound.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS contracts (
        address        TEXT PRIMARY KEY,
        code_hash      TEXT NOT NULL,
        level          TEXT NOT NULL,
        record         TEXT NOT NULL,
        verified_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contracts_code_hash ON contracts(code_hash);
      CREATE INDEX IF NOT EXISTS contracts_verified_at ON contracts(verified_at);
      CREATE TABLE IF NOT EXISTS jobs (
        id         TEXT PRIMARY KEY,
        address    TEXT NOT NULL,
        status     TEXT NOT NULL,
        message    TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  /** Keeps an existing exact match rather than replacing it with a partial one. */
  saveContract(r: ContractRecord): boolean {
    const prev = this.getContract(r.address);
    if (prev && prev.codeHash === r.codeHash && prev.level === 'exact' && r.level === 'partial') return false;
    this.db
      .prepare(
        `INSERT INTO contracts (address, code_hash, level, record, verified_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET code_hash = excluded.code_hash, level = excluded.level,
           record = excluded.record, verified_at = excluded.verified_at`,
      )
      .run(r.address, r.codeHash, r.level, JSON.stringify(r), r.verifiedAt);
    return true;
  }

  setAttestation(address: string, tx: string): void {
    const r = this.getContract(address);
    if (!r) return;
    r.attestationTx = tx;
    this.db.prepare('UPDATE contracts SET record = ? WHERE address = ?').run(JSON.stringify(r), address);
  }

  getContract(address: string): ContractRecord | null {
    const row = this.db.prepare('SELECT record FROM contracts WHERE address = ?').get(address.toLowerCase()) as
      | { record: string }
      | undefined;
    return row ? (JSON.parse(row.record) as ContractRecord) : null;
  }

  /** A verified contract with the same runtime code, if any (same code, other address). */
  findByCodeHash(codeHash: string): ContractRecord | null {
    const row = this.db
      .prepare(`SELECT record FROM contracts WHERE code_hash = ? ORDER BY level = 'exact' DESC, verified_at ASC LIMIT 1`)
      .get(codeHash) as { record: string } | undefined;
    return row ? (JSON.parse(row.record) as ContractRecord) : null;
  }

  listContracts(limit = 50, offset = 0): ContractRecord[] {
    const rows = this.db
      .prepare('SELECT record FROM contracts ORDER BY verified_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as Array<{ record: string }>;
    return rows.map((r) => JSON.parse(r.record) as ContractRecord);
  }

  countContracts(): { total: number; exact: number } {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total, SUM(level = 'exact') AS exact FROM contracts`)
      .get() as { total: number; exact: number | null };
    return { total: row.total, exact: row.exact ?? 0 };
  }

  createJob(id: string, address: string): void {
    this.db
      .prepare('INSERT INTO jobs (id, address, status, message, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, address, 'pending', 'Pending in queue', new Date().toISOString());
  }

  finishJob(id: string, status: Exclude<JobStatus, 'pending'>, message: string): void {
    this.db.prepare('UPDATE jobs SET status = ?, message = ? WHERE id = ?').run(status, message, id);
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as
      | { id: string; address: string; status: JobStatus; message: string; created_at: string }
      | undefined;
    return row ? { id: row.id, address: row.address, status: row.status, message: row.message, createdAt: row.created_at } : null;
  }
}
