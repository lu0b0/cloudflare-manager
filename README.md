# Cloudflare Workers Manager

一个强大的Cloudflare多账号Workers批量管理系统，支持账号管理、批量操作、实时监控和Workers脚本管理。

## 功能特性

### 认证系统
- 主密码保护机制（首次使用需初始化）
- JWT Token认证
- 安全的密码哈希存储（bcrypt）

### 账号管理
- 多Cloudflare账号管理
- 支持两种认证方式：
  - **API Token**（推荐）
  - **Email + Global API Key**（传统方式）
- 账号健康检查
- 自动获取账号subdomain信息
- 批量导入账号

### 批量任务系统
- **6种任务类型**：
  - `create` - 批量创建Worker
  - `update` - 批量更新Worker脚本
  - `delete` - 批量删除Worker
  - `query` - 批量查询Worker信息
  - `list` - 列出账号的所有Workers
  - `health_check` - 批量账号健康检查
- 并发控制（默认3个并发，避免API限流）
- 实时任务进度监控（WebSocket）
- 任务失败自动重试
- 详细的错误日志

### Workers管理
- 列出所有Workers（支持按账号筛选）
- 三种显示模式：全部/按账号分组/自定义筛选
- 同步Workers信息到本地缓存
- 获取Worker脚本源码
- 在线更新Worker脚本
- 删除Worker（需确认）
- 本地缓存机制（减少API调用）

### 数据持久化
- SQLite数据库（WAL模式，高并发）
- 自动数据库迁移
- 外键约束保证数据完整性
- 审计日志记录
- 完整的索引优化

## 技术栈

- **后端框架**: Express.js + TypeScript
- **数据库**: SQLite (better-sqlite3)
- **实时通信**: Socket.IO
- **认证**: JWT + bcrypt
- **前端**: React + TypeScript + TailwindCSS
- **部署**: Docker + Docker Compose

## 快速开始

### 方式1: Docker（推荐）

1. 克隆项目并进入目录
```bash
cd cloudflare-manager
```

2. 创建环境变量文件
```bash
cp .env.example .env
# 编辑.env文件，至少修改JWT_SECRET
```

3. 启动服务
```bash
docker-compose up -d
```

4. 访问应用
```
http://localhost:3000
```

### 方式2: 本地开发

**环境要求**:
- Node.js >= 18
- npm >= 9

**步骤**:

1. 安装依赖
```bash
npm install
```

2. 配置环境变量
```bash
cp .env.example .env
# 编辑.env文件
```

3. 启动开发服务器
```bash
npm run dev
```

5. 访问应用
```
http://localhost:3000
```

## 环境变量

| 变量名 | 说明 | 默认值 | 必需 |
|--------|------|--------|------|
| `PORT` | HTTP服务器端口 | `3000` | 否 |
| `JWT_SECRET` | JWT签名密钥 | - | **是** |
| `DB_PATH` | SQLite数据库文件路径 | `./data.db` | 否 |
| `NODE_ENV` | 运行环境 | `development` | 否 |
| `DEBUG_CF_API` | 调试Cloudflare API请求 | `false` | 否 |

**生产环境建议**:
```bash
NODE_ENV=production
JWT_SECRET=生成一个强随机字符串
DEBUG_CF_API=false
```

## 数据库

### 配置

- **引擎**: SQLite 3
- **模式**: WAL (Write-Ahead Logging)
- **外键**: 启用
- **位置**: `./data.db` (可通过环境变量配置)

### 表结构

| 表名 | 说明 |
|------|------|
| `system_config` | 系统配置（主密码hash） |
| `accounts` | Cloudflare账号信息 |
| `jobs` | 批量任务记录 |
| `tasks` | 任务详情（每个账号一条） |
| `workers` | Workers缓存信息 |
| `script_templates` | 脚本模板（预留） |
| `audit_logs` | 审计日志 |

### 备份建议

```bash
# 停止应用
docker-compose down

# 备份数据库文件（包含WAL文件）
cp data/data.db data/data.db.backup
cp data/data.db-wal data/data.db-wal.backup
cp data/data.db-shm data/data.db-shm.backup

# 或使用SQLite checkpoint
sqlite3 data/data.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp data/data.db data/data.db.backup

# 重启应用
docker-compose up -d
```

## 部署

### Docker生产部署

1. **构建镜像**
```bash
docker build -t cloudflare-manager:latest .
```

2. **运行容器**
```bash
docker run -d \
  --name cloudflare-manager \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e JWT_SECRET=your-secret-key \
  -e NODE_ENV=production \
  cloudflare-manager:latest
```

3. **使用docker-compose（推荐）**
```bash
# 编辑docker-compose.yml配置环境变量
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 传统部署

1. **编译项目**
```bash
npm run build
```

2. **使用PM2**
```bash
npm install -g pm2

pm2 start dist/index.js \
  --name cloudflare-manager \
  --env NODE_ENV=production

pm2 save
pm2 startup
```

3. **Nginx反向代理示例**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket支持
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

## 开发指南

### 目录结构

```
backend/
├── src/
│   ├── db/
│   │   └── schema.ts          # 数据库初始化和迁移
│   ├── middleware/
│   │   └── auth.ts             # JWT认证中间件
│   ├── models/
│   │   └── types.ts            # TypeScript类型定义
│   ├── routes/
│   │   ├── auth.ts             # 认证路由
│   │   ├── accounts.ts         # 账号管理路由
│   │   ├── jobs.ts             # 任务管理路由
│   │   └── workers.ts          # Workers管理路由
│   ├── services/
│   │   ├── CloudflareAPI.ts    # Cloudflare API封装
│   │   ├── JobExecutor.ts      # 任务执行引擎
│   │   └── WorkersService.ts   # Workers服务
│   └── index.ts                # 应用入口
├── public/                     # 前端静态文件
├── data/                       # 数据库文件目录
├── Dockerfile                  # Docker配置
├── docker-compose.yml          # Docker Compose配置
└── package.json
```

### 添加新功能

1. **新增API路由**:
   - 在 `src/routes/` 创建新的路由文件
   - 在 `src/index.ts` 注册路由

2. **新增数据库表**:
   - 在 `src/db/schema.ts` 的 `initDatabase` 函数添加 `CREATE TABLE` SQL
   - 如果是改动现有表，添加自动迁移逻辑

3. **新增Cloudflare API调用**:
   - 在 `src/services/CloudflareAPI.ts` 添加新方法
   - 遵循现有错误处理模式

### 调试技巧

**启用Cloudflare API调试**:
```bash
DEBUG_CF_API=true npm run dev
```

输出示例：
```
[CF API] [5ddb2f59] GET https://api.cloudflare.com/client/v4/...
{
  "headers": { "Authorization": "Bearer ***" }
}
[CF API] [5ddb2f59] ✓ 234ms
{
  "success": true,
  "result": { ... }
}
```

**查看数据库内容**:
```bash
sqlite3 data.db
.tables
SELECT * FROM accounts;
```

### 4. Cloudflare API限流

**错误**: `429 Too Many Requests`

**解决方案**:
- 降低并发数（修改 `JobExecutor` 构造函数的并发参数）
- 检查是否有其他程序在调用同一账号的API
- 等待一段时间后重试

## 许可证

MIT License

---
