import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import Database from 'better-sqlite3';
import type {
  Job,
  Task,
  JobConfig,
  CreateWorkerConfig,
  UpdateWorkerConfig,
  DeleteWorkerConfig,
  QueryWorkerConfig,
  TaskProgress,
  Account,
} from '../models/types.js';
import { CloudflareAPI } from './CloudflareAPI.js';

export class JobExecutor extends EventEmitter {
  private db: Database.Database;
  private concurrencyLimit: number;

  constructor(db: Database.Database, concurrencyLimit: number = 3) {
    super();
    this.db = db;
    this.concurrencyLimit = concurrencyLimit;
  }

  // 创建任务
  createJob(type: Job['type'], config: JobConfig): Job {
    const jobId = nanoid();
    const { accountIds, ...restConfig } = config;

    const job: Job = {
      id: jobId,
      type,
      status: 'pending',
      config,
      totalTasks: accountIds.length,
      completedTasks: 0,
      failedTasks: 0,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO jobs (id, type, status, config, total_tasks, completed_tasks, failed_tasks, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        job.id,
        job.type,
        job.status,
        JSON.stringify(job.config),
        job.totalTasks,
        job.completedTasks,
        job.failedTasks,
        job.createdAt
      );

    // 创建tasks
    accountIds.forEach(accountId => {
      const task: Task = {
        id: nanoid(),
        jobId,
        accountId,
        status: 'pending',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      };
      this.db
        .prepare(
          `INSERT INTO tasks (id, job_id, account_id, status, retry_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(task.id, task.jobId, task.accountId, task.status, task.retryCount, task.createdAt);
    });

    return job;
  }

  // 执行任务
  async executeJob(jobId: string): Promise<void> {
    const job = this.getJob(jobId);
    if (!job) throw new Error('Job not found');

    this.updateJobStatus(jobId, 'running', { startedAt: new Date().toISOString() });

    const tasks = this.getTasks(jobId).filter(t => t.status === 'pending');

    await this.executeBatch(tasks, job);

    // 更新job最终状态
    const updatedTasks = this.getTasks(jobId);
    const completedCount = updatedTasks.filter(t => t.status === 'success').length;
    const failedCount = updatedTasks.filter(t => t.status === 'failed').length;

    let finalStatus: Job['status'] = 'completed';
    if (failedCount > 0 && completedCount > 0) {
      finalStatus = 'partial';
    } else if (failedCount === updatedTasks.length) {
      finalStatus = 'failed';
    }

    this.updateJobStatus(jobId, finalStatus, {
      completedAt: new Date().toISOString(),
      completedTasks: completedCount,
      failedTasks: failedCount,
    });

    this.emit('job:completed', jobId);
  }

  // 批量执行（并发控制）
  private async executeBatch(tasks: Task[], job: Job): Promise<void> {
    const executing: Promise<void>[] = [];

    for (const task of tasks) {
      const p = this.executeTask(task, job).then(() => {
        const index = executing.indexOf(p);
        if (index > -1) executing.splice(index, 1);
      });

      executing.push(p);

      if (executing.length >= this.concurrencyLimit) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
  }

  // 执行单个task
  private async executeTask(task: Task, job: Job): Promise<void> {
    this.updateTaskStatus(task.id, 'running', { startedAt: new Date().toISOString() });
    this.emit('task:update', this.getTask(task.id));

    try {
      const account = this.getAccount(task.accountId);
      if (!account) {
        throw new Error('Account not found');
      }

      const api = new CloudflareAPI(account);
      let result: any;

      switch (job.type) {
        case 'create':
          result = await this.executeCreateWorker(api, job.config as CreateWorkerConfig, task.id);
          break;
        case 'update':
          result = await this.executeUpdateWorker(api, job.config as UpdateWorkerConfig, task.id);
          break;
        case 'delete':
          result = await this.executeDeleteWorker(api, job.config as DeleteWorkerConfig, task.id);
          break;
        case 'query':
          result = await this.executeQueryWorker(api, job.config as QueryWorkerConfig, task.id);
          break;
        case 'list':
          result = await this.executeListWorkers(api, task.id);
          break;
        case 'health_check':
          result = await api.healthCheck();
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      this.updateTaskStatus(task.id, 'success', {
        completedAt: new Date().toISOString(),
        result: JSON.stringify(result),
      });
    } catch (error: any) {
      this.updateTaskStatus(task.id, 'failed', {
        completedAt: new Date().toISOString(),
        error: error.message || 'Unknown error',
      });
    }

    this.emit('task:update', this.getTask(task.id));
  }

  // 创建Worker流程
  private async executeCreateWorker(
    api: CloudflareAPI,
    config: CreateWorkerConfig,
    taskId: string
  ): Promise<any> {
    this.updateTaskProgress(taskId, { step: '创建Worker', current: 1, total: 3 });
    const workerId = await api.createWorker(config.workerName);

    this.updateTaskProgress(taskId, { step: '上传脚本', current: 2, total: 3 });
    const versionId = await api.uploadWorkerScript(
      workerId,
      config.workerName,
      config.script,
      config.compatibilityDate,
      config.bindings
    );

    this.updateTaskProgress(taskId, { step: '部署', current: 3, total: 3 });
    const deploymentId = await api.deployWorker(config.workerName, versionId);

    const subdomain = await api.getSubdomain();
    const url = `https://${config.workerName}.${subdomain}.workers.dev`;

    return { workerId, versionId, deploymentId, url };
  }

  // 更新Worker流程
  private async executeUpdateWorker(
    api: CloudflareAPI,
    config: UpdateWorkerConfig,
    taskId: string
  ): Promise<any> {
    this.updateTaskProgress(taskId, { step: '查找Worker', current: 1, total: 3 });
    const workers = await api.listWorkers();
    const worker = workers.find(w => w.id === config.workerName);
    if (!worker) {
      throw new Error(`Worker ${config.workerName} not found`);
    }

    this.updateTaskProgress(taskId, { step: '上传新脚本', current: 2, total: 3 });
    const versionId = await api.uploadWorkerScript(
      worker.id,
      config.workerName,
      config.script,
      config.compatibilityDate,
      config.bindings
    );

    this.updateTaskProgress(taskId, { step: '部署新版本', current: 3, total: 3 });
    const deploymentId = await api.deployWorker(config.workerName, versionId);

    return { versionId, deploymentId };
  }

  // 删除Worker流程
  private async executeDeleteWorker(
    api: CloudflareAPI,
    config: DeleteWorkerConfig,
    taskId: string
  ): Promise<any> {
    this.updateTaskProgress(taskId, { step: '查找Worker', current: 1, total: 2 });
    const workers = await api.listWorkers();
    const worker = workers.find(w => w.id === config.workerName);
    if (!worker) {
      throw new Error(`Worker ${config.workerName} not found`);
    }

    this.updateTaskProgress(taskId, { step: '删除Worker', current: 2, total: 2 });
    await api.deleteWorker(worker.id);

    return { deleted: true };
  }

  // 查询Worker流程
  private async executeQueryWorker(
    api: CloudflareAPI,
    config: QueryWorkerConfig,
    taskId: string
  ): Promise<any> {
    this.updateTaskProgress(taskId, { step: '查询Worker', current: 1, total: 2 });
    const workers = await api.listWorkers();
    const worker = workers.find(w => w.id === config.workerName);

    if (!worker) {
      return { found: false };
    }

    this.updateTaskProgress(taskId, { step: '获取子域', current: 2, total: 2 });
    const subdomain = await api.getSubdomain();
    const url = `https://${config.workerName}.${subdomain}.workers.dev`;

    return { found: true, worker, url };
  }

  // 列出所有Workers
  private async executeListWorkers(
    api: CloudflareAPI,
    taskId: string
  ): Promise<any> {
    this.updateTaskProgress(taskId, { step: '获取Workers列表', current: 1, total: 2 });
    const workers = await api.listWorkers();

    this.updateTaskProgress(taskId, { step: '获取子域', current: 2, total: 2 });
    const subdomain = await api.getSubdomain();

    const workersWithUrls = workers.map(w => ({
      id: w.id,
      url: `https://${w.id}.${subdomain}.workers.dev`,
      created_on: w.created_on,
      modified_on: w.modified_on,
      etag: w.etag,
    }));

    return {
      subdomain,
      count: workers.length,
      workers: workersWithUrls,
    };
  }

  // 重试失败的tasks
  async retryFailedTasks(jobId: string, taskIds?: string[]): Promise<void> {
    const job = this.getJob(jobId);
    if (!job) throw new Error('Job not found');

    let tasksToRetry: Task[];
    if (taskIds && taskIds.length > 0) {
      tasksToRetry = taskIds
        .map(id => this.getTask(id))
        .filter((t): t is Task => t !== null && t.status === 'failed');
    } else {
      tasksToRetry = this.getTasks(jobId).filter(t => t.status === 'failed');
    }

    tasksToRetry.forEach(t => {
      this.db
        .prepare('UPDATE tasks SET status = ?, retry_count = retry_count + 1 WHERE id = ?')
        .run('pending', t.id);
    });

    await this.executeJob(jobId);
  }

  // 辅助方法
  private getJob(jobId: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      config: JSON.parse(row.config),
      totalTasks: row.total_tasks,
      completedTasks: row.completed_tasks,
      failedTasks: row.failed_tasks,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  private getTask(taskId: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!row) return null;
    return {
      id: row.id,
      jobId: row.job_id,
      accountId: row.account_id,
      status: row.status,
      progress: row.progress ? JSON.parse(row.progress) : undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error,
      retryCount: row.retry_count,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  private getTasks(jobId: string): Task[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE job_id = ?').all(jobId) as any[];
    return rows.map(row => ({
      id: row.id,
      jobId: row.job_id,
      accountId: row.account_id,
      status: row.status,
      progress: row.progress ? JSON.parse(row.progress) : undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error,
      retryCount: row.retry_count,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }));
  }

  private getAccount(accountId: string): Account | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as any;
    if (!row) return null;
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private updateJobStatus(jobId: string, status: Job['status'], extra: Partial<Job> = {}) {
    const updates: string[] = ['status = ?'];
    const values: any[] = [status];

    if (extra.startedAt) {
      updates.push('started_at = ?');
      values.push(extra.startedAt);
    }
    if (extra.completedAt) {
      updates.push('completed_at = ?');
      values.push(extra.completedAt);
    }
    if (extra.completedTasks !== undefined) {
      updates.push('completed_tasks = ?');
      values.push(extra.completedTasks);
    }
    if (extra.failedTasks !== undefined) {
      updates.push('failed_tasks = ?');
      values.push(extra.failedTasks);
    }

    values.push(jobId);
    this.db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  private updateTaskStatus(taskId: string, status: Task['status'], extra: Partial<Task> = {}) {
    const updates: string[] = ['status = ?'];
    const values: any[] = [status];

    if (extra.startedAt) {
      updates.push('started_at = ?');
      values.push(extra.startedAt);
    }
    if (extra.completedAt) {
      updates.push('completed_at = ?');
      values.push(extra.completedAt);
    }
    if (extra.result) {
      updates.push('result = ?');
      values.push(extra.result);
    }
    if (extra.error) {
      updates.push('error = ?');
      values.push(extra.error);
    }

    values.push(taskId);
    this.db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  private updateTaskProgress(taskId: string, progress: TaskProgress) {
    this.db
      .prepare('UPDATE tasks SET progress = ? WHERE id = ?')
      .run(JSON.stringify(progress), taskId);
    this.emit('task:update', this.getTask(taskId));
  }

  // 公共查询方法
  getJobById(jobId: string): Job | null {
    return this.getJob(jobId);
  }

  getTasksByJobId(jobId: string): Task[] {
    return this.getTasks(jobId);
  }

  getAllJobs(limit: number = 50): Job[] {
    const rows = this.db
      .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      status: row.status,
      config: JSON.parse(row.config),
      totalTasks: row.total_tasks,
      completedTasks: row.completed_tasks,
      failedTasks: row.failed_tasks,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }));
  }
}
