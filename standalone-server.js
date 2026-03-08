#!/usr/bin/env node
/**
 * RAG Agent Board - Standalone Server
 * 
 * 独立运行模式，不依赖 OpenClaw Gateway
 * 
 * Usage: node standalone-server.js [--port 3001] [--data ./data]
 */

import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

import express from "express";

import { setAuditDataDir } from "./dist/src/audit.js";
import { createAgentBoardApp } from "./dist/src/app.js";
import { setApiKeyAuthEnabled, setAutoDiscoverOpenClaw, setOpenClawDir, setTemplatesDir } from "./dist/src/routes.js";
import { setDataDir } from "./dist/src/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    port: 3301,
    dataDir: path.join(os.homedir(), ".openclaw", "agent-board"),
    openClawDir: path.join(os.homedir(), ".openclaw"),
    host: "127.0.0.1",
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      result.port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--data" && args[i + 1]) {
      result.dataDir = args[i + 1];
      i++;
    } else if (args[i] === "--host" && args[i + 1]) {
      result.host = args[i + 1];
      i++;
    } else if (args[i] === "--openclaw-dir" && args[i + 1]) {
      result.openClawDir = args[i + 1];
      i++;
    }
  }

  return result;
}

const config = parseArgs();

// 确保数据目录存在
mkdirSync(config.dataDir, { recursive: true });

// 初始化配置
setDataDir(config.dataDir);
setAuditDataDir(config.dataDir);
setTemplatesDir(path.join(__dirname, "templates"));
setApiKeyAuthEnabled(false);
setOpenClawDir(config.openClawDir);
setAutoDiscoverOpenClaw(true);

// 创建 Express 应用
const dashboardDir = path.join(__dirname, "dashboard");
const app = createAgentBoardApp({ dashboardDir });

// 创建 HTTP 服务器
const server = createServer(app);

server.listen(config.port, config.host, () => {
  console.log(``);
  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║  RAG Agent Board - Standalone Server                       ║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║  Dashboard:  http://${config.host}:${config.port}/                    ║`);
  console.log(`║  API:        http://${config.host}:${config.port}/api                  ║`);
  console.log(`║  Data:       ${config.dataDir.padEnd(38)}║`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);
  console.log(``);
  console.log(`Press Ctrl+C to stop the server.`);
});

// 优雅关闭
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close(() => {
    console.log("Server stopped.");
    process.exit(0);
  });
});
