import { Router, Response } from 'express';
import { WorkersService } from '../services/WorkersService.js';
import type { AuthRequest } from '../middleware/auth.js';

export function createWorkersRouter(workersService: WorkersService) {
  const router = Router();

  // GET /api/workers - 获取Workers列表
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const { accountIds } = req.query;
      let accountIdArray: string[] | undefined;

      if (accountIds) {
        if (typeof accountIds === 'string') {
          accountIdArray = accountIds.split(',');
        } else if (Array.isArray(accountIds)) {
          accountIdArray = accountIds as string[];
        }
      }

      const workers = workersService.getWorkers(accountIdArray);
      res.json(workers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/workers/grouped - 获取按账号分组的Workers
  router.get('/grouped', async (req: AuthRequest, res: Response) => {
    try {
      const grouped = workersService.getWorkersByAccount();
      res.json(grouped);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/workers/sync - 同步Workers（单个或多个账号）
  router.post('/sync', async (req: AuthRequest, res: Response) => {
    try {
      const { accountIds } = req.body;

      if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({ error: 'accountIds is required and must be a non-empty array' });
      }

      if (accountIds.length === 1) {
        const count = await workersService.syncAccountWorkers(accountIds[0]);
        return res.json({
          success: true,
          accountId: accountIds[0],
          count
        });
      }

      const results = await workersService.syncMultipleAccounts(accountIds);
      res.json({
        success: true,
        results
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/workers/:workerName/script - 获取Worker脚本
  router.get('/:workerName/script', async (req: AuthRequest, res: Response) => {
    try {
      const { workerName } = req.params;
      const { accountId } = req.query;

      if (!accountId || typeof accountId !== 'string') {
        return res.status(400).json({ error: 'accountId query parameter is required' });
      }

      const script = await workersService.getWorkerScript(workerName, accountId);
      res.json({ script });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/workers/:workerName/script - 更新Worker脚本
  router.put('/:workerName/script', async (req: AuthRequest, res: Response) => {
    try {
      const { workerName } = req.params;
      const { accountId, script } = req.body;

      if (!accountId) {
        return res.status(400).json({ error: 'accountId is required' });
      }

      if (!script) {
        return res.status(400).json({ error: 'script is required' });
      }

      await workersService.updateWorkerScript(workerName, accountId, script);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/workers/:workerName - 删除Worker
  router.delete('/:workerName', async (req: AuthRequest, res: Response) => {
    try {
      const { workerName } = req.params;
      const { accountId } = req.body;

      if (!accountId) {
        return res.status(400).json({ error: 'accountId is required' });
      }

      await workersService.deleteWorker(workerName, accountId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
