# OpenClaw Gateway 源码解读

> 本系列文档深入解析 OpenClaw Gateway 的架构设计与核心实现。

## 概述

OpenClaw Gateway 是 OpenClaw 的核心通信枢纽，提供：

- **WebSocket RPC 服务** - 实时双向通信，支持 140+ 个 RPC 方法
- **会话管理** - 多 Agent、多会话支持，支持 main/dashboard/subagent 三种会话类型
- **事件广播** - 24 种事件类型的实时推送
- **认证授权** - Token、Password、设备身份(Ed25519)等多种认证方式
- **插件扩展** - Channel、Skill、Hook 等扩展机制

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │  WebSocket   │    │    HTTP      │    │   Control    │          │
│  │   Server     │    │   Server     │    │     UI       │          │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │
│         │                   │                   │                  │
│         ▼                   ▼                   ▼                  │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                    Protocol Layer                         │       │
│  │  - Request/Response Frame                                │       │
│  │  - Event Frame                                           │       │
│  │  - Validation (AJV)                                      │       │
│  └─────────────────────────────────────────────────────────┘       │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                    Auth Layer                            │       │
│  │  - Token Auth                                            │       │
│  │  - Password Auth                                         │       │
│  │  - Device Identity (Ed25519)                             │       │
│  │  - Tailscale Auth                                        │       │
│  └─────────────────────────────────────────────────────────┘       │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                    Method Handlers                       │       │
│  │  - sessions.*  - chat.*      - agents.*                  │       │
│  │  - models.*    - tools.*     - config.*                  │       │
│  │  - health.*    - cron.*      - ...                       │       │
│  └─────────────────────────────────────────────────────────┘       │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                    Event System                          │       │
│  │  - agent events (lifecycle, assistant, tool)             │       │
│  │  - chat events (started, delta, final, error)            │       │
│  │  - system events (health, presence, tick)                │       │
│  └─────────────────────────────────────────────────────────┘       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## 文档索引

### 核心文档

| 文档 | 说明 |
|------|------|
| [01-architecture.md](./01-architecture.md) | 架构设计 - 整体架构、组件关系、设计理念 |
| [02-connection-auth.md](./02-connection-auth.md) | 连接与认证 - WebSocket 连接、设备身份、认证流程 |
| [03-protocol.md](./03-protocol.md) | 协议层 - 消息帧格式、请求/响应/事件结构 |
| [04-rpc-methods.md](./04-rpc-methods.md) | RPC 方法详解 - 方法分类、参数结构、调用示例 |
| [05-events.md](./05-events.md) | 事件系统 - 事件类型、事件结构、订阅机制 |

### 功能模块

| 文档 | 说明 |
|------|------|
| [06-sessions.md](./06-sessions.md) | 会话管理 - 会话类型、会话操作、会话 Key 格式 |
| [07-chat.md](./07-chat.md) | 聊天系统 - 消息发送、消息流处理、内容块类型 |
| [08-agents.md](./08-agents.md) | Agent 系统 - Agent 结构、Agent 操作、运行上下文 |
| [09-tools.md](./09-tools.md) | 工具系统 - 工具目录、工具调用、工具事件 |

### 高级功能

| 文档 | 说明 |
|------|------|
| [10-observability.md](./10-observability.md) | 可观测性 - 统计数据、指标、日志、告警 |
| [11-security.md](./11-security.md) | 安全机制 - TLS 验证、速率限制、审计日志 |
| [12-plugins.md](./12-plugins.md) | 插件系统 - Channel、Skill、Hook、插件生命周期 |

## 快速开始

### 连接流程

```
1. WebSocket 连接建立
   ↓
2. 接收 connect.challenge 事件 (包含 nonce)
   ↓
3. 发送 connect 请求 (带设备身份签名)
   ↓
4. 接收 hello-ok 响应 (包含 features、snapshot)
   ↓
5. 连接成功，开始 RPC 调用和事件接收
```

### 核心概念

| 概念 | 说明 |
|------|------|
| **Session** | 会话，对话的容器，格式：`agent:{agentId}:{type}:{id}` |
| **Agent** | 代理实例，可以有多个独立的工作空间和配置 |
| **Run** | 单次对话运行，有唯一的 runId |
| **Event** | 实时事件，包括 agent/chat/health 等 |
| **Scope** | 权限范围，如 operator.admin、operator.read |

## 源码目录

```
src/gateway/
├── server.impl.ts          # Gateway 服务器主入口
├── client.ts               # Gateway 客户端实现
├── call.ts                 # RPC 调用封装
├── auth.ts                 # 认证逻辑
├── boot.ts                 # 启动引导
├── protocol/               # 协议定义
│   ├── index.ts            # 协议入口
│   └── schema.ts           # JSON Schema 定义
├── server-methods/         # RPC 方法实现
│   ├── sessions.ts         # 会话方法
│   ├── chat.ts             # 聊天方法
│   ├── agents.ts           # Agent 方法
│   └── ...
├── server-chat.ts          # 聊天事件处理
└── server-runtime-state.ts # 运行时状态
```

## 版本信息

- **协议版本**: 3
- **支持的 RPC 方法**: 140+
- **支持的事件类型**: 24

## 关键源码文件索引

| 功能 | 文件路径 |
|------|----------|
| 服务器主入口 | `src/gateway/server.impl.ts` |
| 客户端实现 | `src/gateway/client.ts` |
| RPC 调用 | `src/gateway/call.ts` |
| 认证逻辑 | `src/gateway/auth.ts` |
| 协议定义 | `src/gateway/protocol/schema.ts` |
| 会话方法 | `src/gateway/server-methods/sessions.ts` |
| 聊天方法 | `src/gateway/server-methods/chat.ts` |
| Agent 方法 | `src/gateway/server-methods/agents.ts` |
| 事件处理 | `src/gateway/server-chat.ts` |
| 权限控制 | `src/gateway/method-scopes.ts` |
| 设备身份 | `src/infra/device-identity.ts` |
| 插件系统 | `src/plugins/runtime.ts` |
| 速率限制 | `src/gateway/auth-rate-limit.ts` |
| 审计日志 | `src/gateway/control-plane-audit.ts` |
