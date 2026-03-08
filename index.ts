import { mkdirSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

import type { AgentBoardPluginApi } from "./src/plugin-sdk-compat.js";

import { setAuditDataDir } from "./src/audit.js";
import { createAgentBoardApp } from "./src/app.js";
import { createAgentBoardHttpHandler } from "./src/http-handler.js";
import { setApiKeyAuthEnabled, setAutoDiscoverOpenClaw, setOpenClawDir, setTemplatesDir } from "./src/routes.js";
import { setDataDir, registerAgent } from "./src/store.js";
import { setRuntime } from "./src/runtime.js";
import { AGENT_BOARD_TOOL_NAMES, createAgentBoardTools } from "./src/tools.js";

type AgentBoardPluginConfig = {
  dataDir: string;
  openClawDir: string;
  autoDiscoverOpenClaw: boolean;
  standalonePort: number;
  standaloneHost: string;
};

const DEFAULT_BASE_PATH = "/agent-board";
const DEFAULT_PORT = 3456;

function resolveConfig(raw: unknown): AgentBoardPluginConfig {
  const value = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  return {
    dataDir:
      typeof value.dataDir === "string" && value.dataDir.trim()
        ? value.dataDir.trim()
        : path.join(os.homedir(), ".openclaw", "agent-board"),
    openClawDir:
      typeof value.openClawDir === "string" && value.openClawDir.trim()
        ? value.openClawDir.trim()
        : path.join(os.homedir(), ".openclaw"),
    autoDiscoverOpenClaw:
      typeof value.autoDiscoverOpenClaw === "boolean" ? value.autoDiscoverOpenClaw : true,
    standalonePort:
      typeof value.standalonePort === "number" ? value.standalonePort : DEFAULT_PORT,
    standaloneHost:
      typeof value.standaloneHost === "string" ? value.standaloneHost : "127.0.0.1",
  };
}

const dashboardDir = fileURLToPath(new URL("./dashboard", import.meta.url));
const templatesDir = fileURLToPath(new URL("./templates", import.meta.url));

// 存储服务器实例用于优雅关闭
let standaloneServer: ReturnType<typeof createServer> | null = null;

function discoverOpenClawAgents(openClawDir: string): void {
  const configPath = path.join(openClawDir, "openclaw.json");
  if (!existsSync(configPath)) {
    console.log("[agent-board] openclaw.json not found, skipping agent discovery");
    return;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const agents = config?.agents?.list || [];
    
    if (!Array.isArray(agents) || agents.length === 0) {
      console.log("[agent-board] No agents found in openclaw.json");
      return;
    }

    console.log(`[agent-board] Discovering ${agents.length} agents from OpenClaw...`);
    
    for (const agent of agents) {
      if (!agent.id) continue;
      
      registerAgent({
        id: agent.id,
        name: agent.name || agent.id,
        role: "agent",
        status: "online",
        capabilities: agent.tools?.allow || [],
      }).catch(err => {
        console.error(`[agent-board] Failed to register agent ${agent.id}:`, err.message);
      });
    }
    
    console.log(`[agent-board] Successfully registered ${agents.length} agents`);
  } catch (err: any) {
    console.error("[agent-board] Failed to read openclaw.json:", err.message);
  }
}

const plugin = {
  id: "agent-board",
  name: "RAG Agent Board",
  description: "Embedded RAG-oriented board with native tools and a standalone dashboard server.",
  register(api: AgentBoardPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    const dataDir = api.resolvePath(config.dataDir);
    const openClawDir = api.resolvePath(config.openClawDir);

    // 设置 runtime 用于通知功能
    setRuntime(api.runtime);

    mkdirSync(dataDir, { recursive: true });
    setDataDir(dataDir);
    setAuditDataDir(dataDir);
    setTemplatesDir(templatesDir);
    setApiKeyAuthEnabled(false);
    setOpenClawDir(openClawDir);
    setAutoDiscoverOpenClaw(config.autoDiscoverOpenClaw);

    // Auto-discover agents from OpenClaw config
    if (config.autoDiscoverOpenClaw) {
      discoverOpenClawAgents(openClawDir);
    }

    const app = createAgentBoardApp({ dashboardDir });

    api.registerTool((toolCtx) => createAgentBoardTools(api, toolCtx), {
      names: [...AGENT_BOARD_TOOL_NAMES],
    });

    api.registerService({
      id: "agent-board",
      start(ctx) {
        mkdirSync(dataDir, { recursive: true });
        
        // 启动独立 HTTP 服务器
        standaloneServer = createServer(app);
        
        standaloneServer.listen(config.standalonePort, config.standaloneHost, () => {
          ctx.logger.info(``);
          ctx.logger.info(`╔════════════════════════════════════════════════════════════╗`);
          ctx.logger.info(`║  RAG Agent Board - Standalone Server                       ║`);
          ctx.logger.info(`╠════════════════════════════════════════════════════════════╣`);
          ctx.logger.info(`║  Dashboard:  http://${config.standaloneHost}:${config.standalonePort}/`);
          ctx.logger.info(`║  API:        http://${config.standaloneHost}:${config.standalonePort}/api`);
          ctx.logger.info(`║  Data:       ${dataDir}`);
          ctx.logger.info(`╚════════════════════════════════════════════════════════════╝`);
        });

        standaloneServer.on("error", (err) => {
          ctx.logger.error?.(`agent-board server error: ${err.message}`);
        });
      },
      stop(ctx) {
        if (standaloneServer) {
          ctx.logger.info("agent-board: shutting down standalone server...");
          standaloneServer.close(() => {
            ctx.logger.info("agent-board: server stopped.");
          });
        }
      },
    });
  },
};

export default plugin;
