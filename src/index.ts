import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './db/schema.js';
import { authenticateToken } from './middleware/auth.js';
import { createAuthRouter } from './routes/auth.js';
import { createAccountsRouter } from './routes/accounts.js';
import { createJobsRouter } from './routes/jobs.js';
import { createWorkersRouter } from './routes/workers.js';
import { JobExecutor } from './services/JobExecutor.js';
import { WorkersService } from './services/WorkersService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data.db';

// 初始化数据库
const db = initDatabase(DB_PATH);
console.log('Database initialized');

// 初始化JobExecutor和WorkersService
const jobExecutor = new JobExecutor(db, 3);
const workersService = new WorkersService(db);

// Express app
const app = express();
const httpServer = createServer(app);

// Socket.IO
const io = new SocketIO(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  },
});

// 中间件
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API路由
app.use('/api/auth', createAuthRouter(db));
app.use('/api/accounts', authenticateToken, createAccountsRouter(db));
app.use('/api/jobs', authenticateToken, createJobsRouter(db, jobExecutor));
app.use('/api/workers', authenticateToken, createWorkersRouter(workersService));

// 静态文件服务（前端）
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// SPA fallback - 所有非API请求返回index.html
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(publicPath, 'index.html'));
  }
});

// WebSocket连接
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // 订阅job更新
  socket.on('subscribe:job', (jobId: string) => {
    console.log(`Client ${socket.id} subscribed to job ${jobId}`);
    socket.join(`job:${jobId}`);
  });

  // 取消订阅job
  socket.on('unsubscribe:job', (jobId: string) => {
    socket.leave(`job:${jobId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// JobExecutor事件 -> WebSocket推送
jobExecutor.on('task:update', (task) => {
  io.to(`job:${task.jobId}`).emit('task:update', task);
});

jobExecutor.on('job:completed', (jobId) => {
  io.to(`job:${jobId}`).emit('job:completed', jobId);
});

// 错误处理
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// 启动服务器
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket ready for connections`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  httpServer.close(() => {
    db.close();
    console.log('Server closed');
    process.exit(0);
  });
});
