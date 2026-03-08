# Agent Board

`agent-board` 是一个给 OpenClaw / Moltbot gateway 使用的嵌入式看板插件。

## 功能
- 原生工具注册，不依赖 MCP
- 随 gateway 启动，不需要单独进程
- 提供 `/agent-board` 看板界面
- 提供客户视图 `/agent-board/client/:projectId`
- 文件落盘存储项目、任务、评论和审计日志

## 目录
- `src/`: 插件服务、路由、工具和存储逻辑
- `dashboard/`: 看板前端和客户视图
- `templates/`: 内置模板

## 使用
把本插件放到 OpenClaw 的 `extensions/` 目录下，并确保 gateway 会加载该扩展。
