import { Router, Response } from 'express';
import Database from 'better-sqlite3';
import type { AuthRequest } from '../middleware/auth.js';
import { JobExecutor } from '../services/JobExecutor.js';

export function createJobsRouter(db: Database.Database, jobExecutor: JobExecutor): Router {
  const router = Router();

  // 获取所有任务
  router.get('/', (req: AuthRequest, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const jobs = jobExecutor.getAllJobs(limit);
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 获取单个任务
  router.get('/:id', (req: AuthRequest, res: Response) => {
    try {
      const job = jobExecutor.getJobById(req.params.id);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      res.json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 获取任务的所有tasks
  router.get('/:id/tasks', (req: AuthRequest, res: Response) => {
    try {
      const tasks = jobExecutor.getTasksByJobId(req.params.id);
      res.json(tasks);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 创建Worker任务
  router.post('/create-workers', async (req: AuthRequest, res: Response) => {
    try {
      const { accountIds, workerName, script, compatibilityDate, bindings } = req.body;

      if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({ error: 'accountIds array required' });
      }

      if (!workerName || !script) {
        return res.status(400).json({ error: 'workerName and script required' });
      }

      const job = jobExecutor.createJob('create', {
        accountIds,
        workerName,
        script,
        compatibilityDate,
        bindings,
      });

      // 异步执行
      jobExecutor.executeJob(job.id).catch(err => {
        console.error('Job execution error:', err);
      });

      res.status(202).json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 更新Worker任务
  router.post('/update-workers', async (req: AuthRequest, res: Response) => {
    try {
      const { accountIds, workerName, script, compatibilityDate, bindings } = req.body;

      if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({ error: 'accountIds array required' });
      }

      if (!workerName || !script) {
        return res.status(400).json({ error: 'workerName and script required' });
      }

      const job = jobExecutor.createJob('update', {
        accountIds,
        workerName,
        script,
        compatibilityDate,
        bindings,
      });

      jobExecutor.executeJob(job.id).catch(err => {
        console.error('Job execution error:', err);
      });

      res.status(202).json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 删除Worker任务
  router.post('/delete-workers', async (req: AuthRequest, res: Response) => {
    try {
      const { accountIds, workerName } = req.body;

      if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({ error: 'accountIds array required' });
      }

      if (!workerName) {
        return res.status(400).json({ error: 'workerName required' });
      }

      const job = jobExecutor.createJob('delete', { accountIds, workerName });

      jobExecutor.executeJob(job.id).catch(err => {
        console.error('Job execution error:', err);
      });

      res.status(202).json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 查询Worker任务
  router.post('/query-workers', async (req: AuthRequest, res: Response) => {
    try {
      const { accountIds, workerName } = req.body;

      if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({ error: 'accountIds array required' });
      }

      if (!workerName) {
        return res.status(400).json({ error: 'workerName required' });
      }

      const job = jobExecutor.createJob('query', { accountIds, workerName });

      jobExecutor.executeJob(job.id).catch(err => {
        console.error('Job execution error:', err);
      });

      res.status(202).json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 列出Workers任务
  router.post('/list-workers', async (req: AuthRequest, res: Response) => {
    try {
      const { accountIds } = req.body;

      if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({ error: 'accountIds array required' });
      }

      const job = jobExecutor.createJob('list', { accountIds });

      jobExecutor.executeJob(job.id).catch(err => {
        console.error('Job execution error:', err);
      });

      res.status(202).json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 重试失败的tasks
  router.post('/:id/retry', async (req: AuthRequest, res: Response) => {
    try {
      const { taskIds } = req.body;

      const job = jobExecutor.getJobById(req.params.id);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      jobExecutor.retryFailedTasks(req.params.id, taskIds).catch(err => {
        console.error('Retry error:', err);
      });

      res.json({ success: true, message: 'Retry started' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
