import Database from 'better-sqlite3';
import { CloudflareAPI } from './CloudflareAPI.js';
import type { Account } from '../models/types.js';
import crypto from 'crypto';

export interface WorkerRecord {
  id: string;
  accountId: string;
  name: string;
  subdomain: string | null;
  url: string | null;
  scriptHash: string | null;
  createdOn: string | null;
  modifiedOn: string | null;
  lastSynced: string;
}

export class WorkersService {
  constructor(private db: Database.Database) {}

  private mapWorkerRow(row: any): WorkerRecord {
    return {
      id: row.id,
      accountId: row.account_id,
      name: row.name,
      subdomain: row.subdomain,
      url: row.url,
      scriptHash: row.script_hash,
      createdOn: row.created_on,
      modifiedOn: row.modified_on,
      lastSynced: row.last_synced,
    };
  }

  private mapAccountRow(row: any): Account {
    return {
      id: row.id,
      name: row.name,
      authType: row.auth_type,
      accountId: row.account_id,
      apiToken: row.api_token,
      authEmail: row.auth_email,
      authKey: row.auth_key,
      subdomain: row.subdomain,
      status: row.status,
      lastCheck: row.last_check,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async syncAccountWorkers(accountId: string): Promise<number> {
    const accountRow = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!accountRow) {
      throw new Error(`Account ${accountId} not found`);
    }

    const account = this.mapAccountRow(accountRow);
    const api = new CloudflareAPI(account);

    try {
      const [workers, subdomain] = await Promise.all([
        api.listWorkers(),
        api.getSubdomain(),
      ]);

      const deleteStmt = this.db.prepare('DELETE FROM workers WHERE account_id = ?');
      deleteStmt.run(accountId);

      if (workers.length === 0) {
        return 0;
      }

      const insertStmt = this.db.prepare(`
        INSERT INTO workers (id, account_id, name, subdomain, url, script_hash, created_on, modified_on, last_synced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      const insert = this.db.transaction((workersList: any[]) => {
        for (const worker of workersList) {
          const workerId = crypto.randomUUID();
          const url = `https://${worker.id}.${subdomain}.workers.dev`;
          insertStmt.run(
            workerId,
            accountId,
            worker.id,
            subdomain,
            url,
            worker.etag || null,
            worker.created_on || null,
            worker.modified_on || null
          );
        }
      });

      insert(workers);

      this.db.prepare('UPDATE accounts SET subdomain = ?, last_check = CURRENT_TIMESTAMP WHERE id = ?')
        .run(subdomain, accountId);

      return workers.length;
    } catch (error: any) {
      throw new Error(`Failed to sync workers for account ${accountId}: ${error.message}`);
    }
  }

  async syncMultipleAccounts(accountIds: string[]): Promise<{ [accountId: string]: number | string }> {
    const results: { [accountId: string]: number | string } = {};

    for (const accountId of accountIds) {
      try {
        const count = await this.syncAccountWorkers(accountId);
        results[accountId] = count;
      } catch (error: any) {
        results[accountId] = `Error: ${error.message}`;
      }
    }

    return results;
  }

  getWorkers(accountIds?: string[]): WorkerRecord[] {
    let query = 'SELECT * FROM workers';
    const params: string[] = [];

    if (accountIds && accountIds.length > 0) {
      const placeholders = accountIds.map(() => '?').join(',');
      query += ` WHERE account_id IN (${placeholders})`;
      params.push(...accountIds);
    }

    query += ' ORDER BY account_id, name';

    const rows = this.db.prepare(query).all(...params);
    return rows.map(row => this.mapWorkerRow(row));
  }

  async getWorkerScript(workerName: string, accountId: string): Promise<string> {
    const accountRow = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!accountRow) {
      throw new Error(`Account ${accountId} not found`);
    }

    const account = this.mapAccountRow(accountRow);
    const api = new CloudflareAPI(account);
    return await api.downloadWorkerScript(workerName);
  }

  async updateWorkerScript(workerName: string, accountId: string, script: string): Promise<void> {
    const accountRow = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!accountRow) {
      throw new Error(`Account ${accountId} not found`);
    }

    const workerRow = this.db.prepare('SELECT * FROM workers WHERE name = ? AND account_id = ?')
      .get(workerName, accountId) as WorkerRecord | undefined;

    if (!workerRow) {
      throw new Error(`Worker ${workerName} not found in account ${accountId}`);
    }

    const account = this.mapAccountRow(accountRow);
    const api = new CloudflareAPI(account);
    const workers = await api.listWorkers();
    const cfWorker = workers.find(w => w.id === workerName);

    if (!cfWorker) {
      throw new Error(`Worker ${workerName} not found in Cloudflare`);
    }

    const workerId = workerName;
    await api.updateWorkerScript(workerId, workerName, script);

    this.db.prepare('UPDATE workers SET modified_on = CURRENT_TIMESTAMP, last_synced = CURRENT_TIMESTAMP WHERE id = ?')
      .run(workerRow.id);
  }

  async deleteWorker(workerName: string, accountId: string): Promise<void> {
    const accountRow = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!accountRow) {
      throw new Error(`Account ${accountId} not found`);
    }

    const workerRow = this.db.prepare('SELECT * FROM workers WHERE name = ? AND account_id = ?')
      .get(workerName, accountId) as WorkerRecord | undefined;

    if (!workerRow) {
      throw new Error(`Worker ${workerName} not found in database`);
    }

    const account = this.mapAccountRow(accountRow);
    const api = new CloudflareAPI(account);

    const workers = await api.listWorkers();
    const cfWorker = workers.find(w => w.id === workerName);

    if (cfWorker) {
      await api.deleteWorker(workerName);
    }

    this.db.prepare('DELETE FROM workers WHERE id = ?').run(workerRow.id);
  }

  getWorkersByAccount(): { [accountId: string]: WorkerRecord[] } {
    const workers = this.getWorkers();
    const grouped: { [accountId: string]: WorkerRecord[] } = {};

    for (const worker of workers) {
      if (!grouped[worker.accountId]) {
        grouped[worker.accountId] = [];
      }
      grouped[worker.accountId].push(worker);
    }

    return grouped;
  }

  getAccountInfo(accountId: string): Account | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    return row ? this.mapAccountRow(row) : null;
  }
}
