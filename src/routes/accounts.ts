import { Router, Response } from 'express';
import { nanoid } from 'nanoid';
import Database from 'better-sqlite3';
import type { AuthRequest } from '../middleware/auth.js';
import type { Account } from '../models/types.js';
import { CloudflareAPI } from '../services/CloudflareAPI.js';

export function createAccountsRouter(db: Database.Database): Router {
  const router = Router();

  // 获取所有账号
  router.get('/', (req: AuthRequest, res: Response) => {
    try {
      const accounts = db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all() as any[];
      const result: Account[] = accounts.map(row => ({
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
      }));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 获取单个账号
  router.get('/:id', (req: AuthRequest, res: Response) => {
    try {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
      if (!row) {
        return res.status(404).json({ error: 'Account not found' });
      }
      const account: Account = {
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
      res.json(account);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 创建账号
  router.post('/', (req: AuthRequest, res: Response) => {
    try {
      const { name, authType, accountId, apiToken, authEmail, authKey } = req.body;

      if (!name || !authType || !accountId) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (authType === 'token' && !apiToken) {
        return res.status(400).json({ error: 'apiToken required for token auth' });
      }

      if (authType === 'email-key' && (!authEmail || !authKey)) {
        return res.status(400).json({ error: 'authEmail and authKey required for email-key auth' });
      }

      const id = nanoid();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO accounts (id, name, auth_type, account_id, api_token, auth_email, auth_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, name, authType, accountId, apiToken || null, authEmail || null, authKey || null, 'active', now, now);

      const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as any;
      res.status(201).json({
        id: account.id,
        name: account.name,
        authType: account.auth_type,
        accountId: account.account_id,
        status: account.status,
        createdAt: account.created_at,
        updatedAt: account.updated_at,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 批量导入账号
  router.post('/import', (req: AuthRequest, res: Response) => {
    try {
      const { accounts } = req.body;

      if (!Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({ error: 'accounts array required' });
      }

      const inserted: string[] = [];
      const errors: Array<{ line: number; error: string }> = [];

      accounts.forEach((acc, index) => {
        try {
          const { name, authType, accountId, apiToken, authEmail, authKey } = acc;

          if (!authType || !accountId) {
            throw new Error('Missing authType or accountId');
          }

          if (authType === 'token' && !apiToken) {
            throw new Error('apiToken required');
          }

          if (authType === 'email-key' && (!authEmail || !authKey)) {
            throw new Error('authEmail and authKey required');
          }

          const id = nanoid();
          const now = new Date().toISOString();
          const accountName = name || `Account ${accountId.substring(0, 8)}`;

          db.prepare(
            `INSERT INTO accounts (id, name, auth_type, account_id, api_token, auth_email, auth_key, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            id,
            accountName,
            authType,
            accountId,
            apiToken || null,
            authEmail || null,
            authKey || null,
            'active',
            now,
            now
          );

          inserted.push(id);
        } catch (error: any) {
          errors.push({ line: index + 1, error: error.message });
        }
      });

      res.json({
        success: true,
        imported: inserted.length,
        failed: errors.length,
        errors,
        accountIds: inserted,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 更新账号
  router.put('/:id', (req: AuthRequest, res: Response) => {
    try {
      const { name, authType, accountId, apiToken, authEmail, authKey } = req.body;

      const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Account not found' });
      }

      const now = new Date().toISOString();

      db.prepare(
        `UPDATE accounts
         SET name = ?, auth_type = ?, account_id = ?, api_token = ?, auth_email = ?, auth_key = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        name,
        authType,
        accountId,
        apiToken || null,
        authEmail || null,
        authKey || null,
        now,
        req.params.id
      );

      const updated = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
      res.json({
        id: updated.id,
        name: updated.name,
        authType: updated.auth_type,
        accountId: updated.account_id,
        status: updated.status,
        updatedAt: updated.updated_at,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 删除账号
  router.delete('/:id', (req: AuthRequest, res: Response) => {
    try {
      const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Account not found' });
      }

      db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 健康检查账号（使用获取子域接口）
  router.post('/:id/health-check', async (req: AuthRequest, res: Response) => {
    try {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
      if (!row) {
        return res.status(404).json({ error: 'Account not found' });
      }

      const account: Account = {
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
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      const api = new CloudflareAPI(account);

      let isHealthy = false;
      let subdomain: string | null = null;
      let errorMessage: string | null = null;

      try {
        // 使用获取子域接口作为健康检查
        subdomain = await api.getSubdomain();
        isHealthy = true;
      } catch (error: any) {
        isHealthy = false;
        errorMessage = error.message;
      }

      const status = isHealthy ? 'active' : 'error';
      const now = new Date().toISOString();

      // 同时更新状态、子域信息和错误信息
      db.prepare('UPDATE accounts SET status = ?, subdomain = ?, last_check = ?, last_error = ? WHERE id = ?').run(
        status,
        subdomain,
        now,
        errorMessage,
        req.params.id
      );

      res.json({
        healthy: isHealthy,
        status,
        subdomain,
        lastCheck: now,
        error: errorMessage
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
