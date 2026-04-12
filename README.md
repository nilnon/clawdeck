# 🦞 ClawDeck

> **ClawDeck — 统一 AI Agent 工作台**

统一管理 OpenClaw、Hermes-Agent 等多种 AI Agent 的 Web 工作台。

## 架构概览

```
Browser ──→ ClawDeck (:4098)
              │
    ┌─────────┼──────────┐
    │         │          │
  OpenClaw  Hermes     (Future
  Adapter   Adapter     Agents)
  WS+RPC    ACP/CLI
```

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + Vite 7 + Tailwind CSS 4 |
| 后端 | Hono 4 + Node.js 22 |
| 数据库 | SQLite (better-sqlite3) |
| 实时通信 | WebSocket + SSE |
| 部署 | Docker / Docker Compose |

## 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量（可选，已有默认 .env）
# cp .env .env.local

# 启动开发模式（前端:4096 + 后端:4098）
npm run dev

# 生产构建
npm run build && npm start
```

## Docker 部署

```bash
# 仅 ClawDeck
docker compose up -d

# 带 OpenClaw
docker compose --profile with-openclaw up -d

# 带 Hermes-Agent
docker compose --profile with-hermes up -d
```

## 配置说明

环境变量见 `.env` 文件：

### 核心配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 4098 | 后端服务端口 |
| VITE_API_URL | http://localhost:4098 | API 服务地址 |
| VITE_DEV_PORT | 4096 | Vite 开发服务器端口 |
| FRONTEND_URL | http://localhost:4096 | 前端 URL（用于 CORS 配置） |
| HOST | localhost | 主机地址 |
| VITE_APP_TITLE | ClawDeck | 应用标题 |

### 数据库配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| DATABASE_PATH | ./data/clawdeck.db | SQLite 数据库路径 |

### 认证配置（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| AUTH_ENABLED | false | 是否启用认证 |
| AUTH_SECRET | - | 认证密钥 |

### OpenClaw 适配器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| VITE_OPENCLAW_GATEWAY_URL | ws://localhost:18789 | OpenClaw Gateway WebSocket 地址 |
| VITE_OPENCLAW_HTTP_URL | http://localhost:18789 | OpenClaw HTTP 地址（用于工具调用） |
| VITE_OPENCLAW_GATEWAY_TOKEN | - | OpenClaw Gateway 认证令牌 |

### Hermes 适配器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| VITE_HERMES_ACP_URL | http://localhost:8642 | Hermes ACP Server 地址 |
| VITE_HERMES_CLI_PATH | hermes | Hermes CLI 可执行文件路径 |

### Docker 环境变量

Docker 部署时使用以下配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3080 | 容器内服务端口 |
| DATABASE_PATH | ./data/clawdeck.db | 容器内数据库路径 |
| OPENCLAW_GATEWAY_URL | ws://openclaw:18789 | OpenClaw 容器地址 |
| HERMES_ACP_URL | http://hermes:8478 | Hermes 容器地址 |

## 项目结构

```
clawdeck/
├── src/                    # React 前端
│   ├── contexts/           # Context Providers (Agent, Session)
│   ├── features/chat/      # ChatPanel 组件
│   ├── pages/              # 页面 (Dashboard, Chat, Settings)
│   └── layouts/            # MainLayout
├── server/                 # Hono 后端
│   ├── adapters/           # Agent 适配器 (openclaw, hermes)
│   │   ├── openclaw/       # WS RPC Client + Adapter
│   │   └── hermes/         # ACP Bridge + CLI Fallback + Adapter
│   ├── routes/             # API 路由 (agents, chat, sessions, tools, models)
│   ├── ws/                 # WebSocket Gateway
│   ├── lib/                # 工具库 (adapter-registry)
│   └── db/                 # SQLite 初始化
├── shared/                 # 共享类型定义 (IAgentAdapter interface)
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 添加新 Agent 类型

1. 在 `server/adapters/` 下创建新目录
2. 实现 `IAgentAdapter` 接口（来自 `@shared/types`）
3. 在 `server/routes/agents.ts` 的 switch 中注册类型
4. 完成！
