# ClawDeck 开发规范

## 项目概述

ClawDeck 是统一 Agent 工作台，提供 Web UI 管理多种 AI Agent 后端。

## 目录规范

- `src/` — React 前端代码，使用 `@/` 别名导入
- `server/` — Hono 后端代码，使用 `@server/` 别名导入
- `shared/` — 前后端共享 TypeScript 类型，使用 `@shared/` 别名导入
- 新增页面 → `src/pages/XxxPage.tsx`
- 新增组件 → `src/components/` 或对应 feature 目录
- 新增 API 路由 → `server/routes/xxx.ts`
- 新增适配器 → `server/adapters/<type>/index.ts`

## 代码风格

- TypeScript strict mode 全程开启
- ESM only (`import/export`, no `require`)
- 函数式组件 + Hooks
- 无 class 组件（除 adapter 类实现 IAgentAdapter 接口外）
- CSS 使用 Tailwind CSS utility classes，自定义变量在 `src/index.css`
- 不写注释（除非文档需要）

## IAgentAdapter 接口

所有 Agent 适配器必须实现 `shared/types.ts` 中定义的 `IAgentAdapter` 接口。

核心方法：
- `connect(config)` / `disconnect()` — 生命周期
- `chat(message)` — 返回 AsyncIterable<ChatChunk>（流式）
- `listSessions/getSession/createSession/deleteSession` — 会话管理
- `listTools/invokeTool` — 工具调用
- `onStatusChange/onEvent` — 事件订阅

## API 规范

- REST API 以 `/api/` 为前缀
- WebSocket endpoint: `/api/ws`
- Agent 选择通过 `X-Agent-ID` header
- Chat 返回 SSE stream (`text/event-stream`)
- 错误返回 JSON `{ error: "message" }` + HTTP status code

## 测试

```bash
npm run test        # Vitest
npm run lint        # ESLint
```
