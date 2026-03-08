# RAG Agent Board

RAG Agent Board 是一个面向 OpenClaw 的嵌入式看板插件，可用于管理 RAG 风格的 agent 工作流。

它把任务看板、原生工具调用、客户进度视图和本地文件存储整合到同一个插件中，不需要额外启动独立服务。

## 特性
- 原生 OpenClaw 工具注册，不依赖 MCP 服务进程
- 作为 gateway 内嵌插件运行，挂载到 `/agent-board`
- 提供内部看板界面和客户视图
- 支持项目、任务、评论、审计日志的文件落盘存储
- 支持从 OpenClaw 自动发现 agent 并合并到面板列表
- 支持任务移动、评论线程、基础统计和客户状态页

## 路由
- 看板主页: `/agent-board`
- API 前缀: `/agent-board/api`
- 客户视图: `/agent-board/client/:projectId`

兼容性说明：插件对外展示名已经切到 `RAG Agent Board`，但内部插件 `id`、默认数据目录和 HTTP 路由仍保留 `agent-board`，避免破坏现有接入。

## 目录结构
- `src/`: 插件后端、路由、工具和存储逻辑
- `dashboard/`: 主看板和客户视图前端
- `templates/`: 内置模板数据
- `openclaw.plugin.json`: OpenClaw 新版插件 manifest
- `clawdbot.plugin.json`: 旧版兼容 manifest
- `index.ts`: 插件入口

## 安装

### 推荐：作为独立插件安装到当前 OpenClaw

在仓库目录执行：

```bash
openclaw plugins install --link .
```

安装完成后重启 gateway。

如果你的环境启用了插件 allowlist，还需要把 `agent-board` 加进 `plugins.allow`。

### 开发态：放进 OpenClaw 源码仓库的 `extensions/`

把目录放到源码仓库中的 `extensions/agent-board/`，然后启用插件：

```bash
openclaw plugins enable agent-board
```

随后重启 gateway。

## 配置
插件支持以下配置项，路径位于 `plugins.entries.agent-board.config`：

- `dataDir`: 面板数据和审计日志存储目录
- `openClawDir`: OpenClaw 主目录，用于自动发现 agent
- `autoDiscoverOpenClaw`: 是否自动把 OpenClaw agent 合并到面板中

默认情况下，数据会写到：

```bash
~/.openclaw/agent-board
```

## 原生工具
插件会注册以下原生工具：

- `board_list_projects`
- `board_get_project`
- `board_create_project`
- `board_update_project`
- `board_create_task`
- `board_update_task`
- `board_move_task`
- `board_add_comment`
- `board_list_comments`
- `board_get_task_thread`
- `board_list_tasks`
- `board_my_tasks`
- `board_delete_task`
- `board_delete_project`

## 技术栈
- TypeScript
- Express
- TypeBox
- Zod
- GitHub-hosted dashboard assets

## License
MIT
