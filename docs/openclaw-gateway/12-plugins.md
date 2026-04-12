# 插件系统

> **本文档引用的源码文件**
> - `src/plugins/runtime.ts` - 插件运行时
> - `src/plugins/types.ts` - 插件类型定义

## 目录

1. [简介](#简介)
2. [插件类型](#插件类型)
3. [Channel 插件](#channel-插件)
4. [Skill 插件](#skill-插件)
5. [Hook 插件](#hook-插件)
6. [插件生命周期](#插件生命周期)
7. [开发插件](#开发插件)

## 简介

Gateway 支持三种插件类型，用于扩展功能：

- **Channel** - 通信渠道扩展（如 Zalo, LINE, Discord）
- **Skill** - 技能扩展（如 GitHub, Notion, Slack）
- **Hook** - 钩子扩展（如 Gmail, Webhook）

## 插件类型

| 类型 | 说明 | 触发方式 | 示例 |
|------|------|----------|------|
| Channel | 通信渠道 | 外部消息触发 | Zalo, LINE, IRC, Discord |
| Skill | 技能扩展 | Agent 主动调用 | GitHub, Notion, Slack, Jira |
| Hook | 钩子扩展 | 事件触发 | Gmail, Webhook, Custom |

### 对比

```
┌─────────────────────────────────────────────────────────────────────┐
│                        插件类型对比                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Channel                          Skill                              │
│  ┌─────────┐                      ┌─────────┐                       │
│  │ 外部用户 │ ──消息──► Gateway   │  Agent   │ ──调用──► Skill       │
│  └─────────┘                      └─────────┘                       │
│       │                                  │                           │
│       ▼                                  ▼                           │
│  ┌─────────┐                      ┌─────────┐                       │
│  │ Gateway │ ──转发──► Agent      │  Skill   │ ──执行──► 操作       │
│  └─────────┘                      └─────────┘                       │
│                                                                      │
│  Hook                                                               │
│  ┌─────────┐                                                       │
│  │  事件   │ ──触发──► Hook ──执行──► 操作                         │
│  └─────────┘                                                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Channel 插件

### 功能

Channel 插件用于连接外部通信平台：

- 接收外部消息
- 转换为 Gateway 消息格式
- 发送到 Agent 处理
- 返回响应到外部平台

### 结构

```typescript
type ChannelPlugin = {
  id: string                    // 插件 ID
  name: string                  // 显示名称
  type: 'channel'
  enabled: boolean
  autoStart: boolean            // 是否自动启动
  
  config: {
    // 平台特定配置
    [key: string]: unknown
  }
  
  handlers: {
    onMessage: (message: ExternalMessage) => Promise<GatewayMessage>
    onResponse: (response: AgentResponse) => Promise<void>
    onStart: () => Promise<void>
    onStop: () => Promise<void>
  }
}
```

### 示例：Zalo Channel

```typescript
const zaloChannel: ChannelPlugin = {
  id: 'zalo',
  name: 'Zalo',
  type: 'channel',
  enabled: true,
  autoStart: true,
  
  config: {
    appId: 'your-app-id',
    appSecret: 'your-app-secret',
    oaId: 'your-oa-id'
  },
  
  handlers: {
    async onMessage(external) {
      return {
        sessionKey: `agent:main:channel:zalo:${external.senderId}`,
        content: external.text,
        metadata: { platform: 'zalo' }
      }
    },
    
    async onResponse(response) {
      await sendZaloMessage({
        recipientId: response.metadata.senderId,
        text: response.content
      })
    },
    
    async onStart() {
      await startZaloWebhook()
    },
    
    async onStop() {
      await stopZaloWebhook()
    }
  }
}
```

### Channel 方法

```typescript
// 列出 Channel
const channels = await rpc.call('channels.status')

// 启动 Channel
await rpc.call('channels.start', { channelId: 'zalo' })

// 停止 Channel
await rpc.call('channels.stop', { channelId: 'zalo' })

// 登出 Channel
await rpc.call('channels.logout', { channelId: 'zalo' })
```

## Skill 插件

### 功能

Skill 插件提供可调用的技能：

- 定义工具接口
- 处理工具调用
- 返回执行结果

### 结构

```typescript
type SkillDefinition = {
  id: string                    // 技能 ID
  name: string                  // 显示名称
  description: string           // 描述
  version: string
  
  tools: ToolDefinition[]       // 提供的工具
  
  handlers: {
    execute: (toolName: string, params: unknown) => Promise<unknown>
  }
}
```

### 示例：GitHub Skill

```typescript
const githubSkill: SkillDefinition = {
  id: 'github',
  name: 'GitHub',
  description: 'GitHub integration skill',
  version: '1.0.0',
  
  tools: [
    {
      name: 'github_create_issue',
      description: 'Create a GitHub issue',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository name' },
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Issue body' }
        },
        required: ['repo', 'title']
      }
    },
    {
      name: 'github_list_prs',
      description: 'List pull requests',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed', 'all'] }
        }
      }
    }
  ],
  
  handlers: {
    async execute(toolName, params) {
      switch (toolName) {
        case 'github_create_issue':
          return await createIssue(params)
        case 'github_list_prs':
          return await listPRs(params)
        default:
          throw new Error(`Unknown tool: ${toolName}`)
      }
    }
  }
}
```

### Skill 方法

```typescript
// 搜索技能
const skills = await rpc.call('skills.search', { query: 'github' })

// 获取技能详情
const detail = await rpc.call('skills.detail', { skillId: 'github' })

// 安装技能
await rpc.call('skills.install', { skillId: 'github' })

// 更新技能
await rpc.call('skills.update', { skillId: 'github' })
```

## Hook 插件

### 功能

Hook 插件用于事件驱动的自动化：

- 监听特定事件
- 执行自定义逻辑
- 可触发其他操作

### 结构

```typescript
type HookDefinition = {
  id: string                    // Hook ID
  name: string                  // 显示名称
  events: string[]              // 监听的事件
  
  config: {
    filter?: object             // 事件过滤条件
    actions: HookAction[]       // 执行的动作
  }
}

type HookAction = 
  | { type: 'notify'; target: string }
  | { type: 'webhook'; url: string }
  | { type: 'script'; code: string }
```

### 示例：Webhook Hook

```typescript
const webhookHook: HookDefinition = {
  id: 'webhook-notify',
  name: 'Webhook Notifier',
  events: ['agent', 'chat'],
  
  config: {
    filter: {
      'payload.stream': 'lifecycle',
      'payload.data.phase': 'end'
    },
    actions: [
      {
        type: 'webhook',
        url: 'https://example.com/webhook'
      }
    ]
  }
}
```

### Hook 触发流程

```
事件发生
    ↓
检查 Hook 过滤条件
    ↓
执行 Hook 动作
    ↓
记录执行结果
```

## 插件生命周期

### 加载流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        插件加载流程                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 加载内置插件 (bundled)                                           │
│     - 扫描 plugins/bundled 目录                                     │
│     - 加载插件定义                                                   │
│     ↓                                                                │
│  2. 加载配置的插件 (configured)                                      │
│     - 读取配置文件中的插件列表                                       │
│     - 加载插件代码                                                   │
│     ↓                                                                │
│  3. 注册插件                                                         │
│     - Channel: 注册到 channel registry                              │
│     - Skill: 注册到 skill registry                                  │
│     - Hook: 注册到 hook registry                                    │
│     ↓                                                                │
│  4. 启动自动启动的 Channel                                          │
│     - 调用 onStart 处理器                                           │
│     - 建立外部连接                                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 插件运行时

```typescript
// 源码: src/plugins/runtime.ts
type PluginRuntime = {
  channel: {
    start(plugin: ChannelPlugin): Promise<void>
    stop(plugin: ChannelPlugin): Promise<void>
    list(): ChannelPlugin[]
    get(channelId: string): ChannelPlugin | undefined
  }
  
  skill: {
    register(skill: SkillDefinition): void
    unregister(skillId: string): void
    list(): SkillDefinition[]
    get(skillId: string): SkillDefinition | undefined
    execute(skillId: string, toolName: string, params: unknown): Promise<unknown>
  }
  
  hook: {
    register(hook: HookDefinition): void
    unregister(hookId: string): void
    list(): HookDefinition[]
    trigger(event: { type: string; payload: unknown }): Promise<void>
  }
}
```

## 开发插件

### 插件模板

```typescript
// my-plugin/index.ts
import { definePlugin } from '@openclaw/plugin-sdk'

export default definePlugin({
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  
  // Channel 定义（可选）
  channel?: {
    config: { /* 配置 Schema */ },
    handlers: { /* 处理器 */ }
  },
  
  // Skill 定义（可选）
  skill?: {
    tools: [ /* 工具定义 */ ],
    handlers: { /* 处理器 */ }
  },
  
  // Hook 定义（可选）
  hooks?: [ /* Hook 定义 */ ]
})
```

### 发布插件

```bash
# 构建插件
npm run build

# 发布到插件市场
openclaw plugin publish
```

### 安装插件

```bash
# 从市场安装
openclaw plugin install my-plugin

# 从本地安装
openclaw plugin install ./path/to/plugin
```
