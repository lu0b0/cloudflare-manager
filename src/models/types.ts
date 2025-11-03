// 账号认证类型
export type AuthType = 'token' | 'email-key';

export interface TokenAuth {
  type: 'token';
  accountId: string;
  apiToken: string;
}

export interface EmailKeyAuth {
  type: 'email-key';
  accountId: string;
  authEmail: string;
  authKey: string;
}

export type AccountAuth = TokenAuth | EmailKeyAuth;

// 账号模型
export interface Account {
  id: string;
  name: string;
  authType: AuthType;
  accountId: string;
  apiToken?: string;
  authEmail?: string;
  authKey?: string;
  subdomain?: string;
  status: 'active' | 'inactive' | 'error';
  lastCheck?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// 任务模型
export type JobType = 'create' | 'update' | 'delete' | 'query' | 'list' | 'health_check';
export type JobStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  config: JobConfig;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Task {
  id: string;
  jobId: string;
  accountId: string;
  status: TaskStatus;
  progress?: TaskProgress;
  result?: any;
  error?: string;
  retryCount: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskProgress {
  step: string;
  current: number;
  total: number;
  message?: string;
}

// 任务配置
export interface BaseJobConfig {
  accountIds: string[];
}

export interface CreateWorkerConfig extends BaseJobConfig {
  workerName: string;
  script: string;
  compatibilityDate?: string;
  bindings?: WorkerBinding[];
}

export interface UpdateWorkerConfig extends BaseJobConfig {
  workerName: string;
  script: string;
  compatibilityDate?: string;
  bindings?: WorkerBinding[];
}

export interface DeleteWorkerConfig extends BaseJobConfig {
  workerName: string;
}

export interface QueryWorkerConfig extends BaseJobConfig {
  workerName: string;
}

export interface ListWorkersConfig extends BaseJobConfig {
  // 不需要额外参数，只需要accountIds
}

export type JobConfig = CreateWorkerConfig | UpdateWorkerConfig | DeleteWorkerConfig | QueryWorkerConfig | ListWorkersConfig;

// Worker绑定
export interface WorkerBinding {
  type: 'plain_text' | 'secret_text' | 'kv_namespace' | 'd1' | 'r2_bucket';
  name: string;
  text?: string;
  namespaceId?: string;
  databaseId?: string;
  bucketName?: string;
}

// 审计日志
export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: any;
  ipAddress?: string;
  timestamp: string;
}

// Cloudflare API响应
export interface CFApiResponse<T = any> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: T;
}

export interface CFWorker {
  id: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  created_on?: string;
  etag?: string;
  modified_on?: string;
  usage_model?: 'standard' | 'bundled' | 'unbound';
}

export interface CFSubdomain {
  subdomain: string;
}

// Worker记录（数据库）
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

// 脚本模板
export interface ScriptTemplate {
  id: string;
  name: string;
  description: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateRequest {
  name: string;
  description?: string;
  content: string;
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  content?: string;
}
