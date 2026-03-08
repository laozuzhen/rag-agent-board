import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MoltbotPluginApi } from "clawdbot/plugin-sdk";

import { setAuditDataDir } from "./src/audit.js";
import { createAgentBoardApp } from "./src/app.js";
import { createAgentBoardHttpHandler } from "./src/http-handler.js";
import { setApiKeyAuthEnabled, setAutoDiscoverOpenClaw, setOpenClawDir, setTemplatesDir } from "./src/routes.js";
import { setDataDir } from "./src/store.js";
import { AGENT_BOARD_TOOL_NAMES, createAgentBoardTools } from "./src/tools.js";

type AgentBoardPluginConfig = {
  dataDir: string;
  openClawDir: string;
  autoDiscoverOpenClaw: boolean;
};

const DEFAULT_BASE_PATH = "/agent-board";

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
  };
}

const dashboardDir = fileURLToPath(new URL("./dashboard", import.meta.url));
const templatesDir = fileURLToPath(new URL("./templates", import.meta.url));

const plugin = {
  id: "agent-board",
  name: "RAG Agent Board",
  description: "Embedded RAG-oriented board with native tools and a gateway-hosted dashboard.",
  register(api: MoltbotPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    const dataDir = api.resolvePath(config.dataDir);
    const openClawDir = api.resolvePath(config.openClawDir);

    mkdirSync(dataDir, { recursive: true });
    setDataDir(dataDir);
    setAuditDataDir(dataDir);
    setTemplatesDir(templatesDir);
    setApiKeyAuthEnabled(false);
    setOpenClawDir(openClawDir);
    setAutoDiscoverOpenClaw(config.autoDiscoverOpenClaw);

    const app = createAgentBoardApp({ dashboardDir });

    api.registerTool((toolCtx) => createAgentBoardTools(api, toolCtx), {
      names: [...AGENT_BOARD_TOOL_NAMES],
    });

    api.registerHttpHandler(createAgentBoardHttpHandler({ app, basePath: DEFAULT_BASE_PATH }));

    api.registerService({
      id: "agent-board",
      start(ctx) {
        mkdirSync(dataDir, { recursive: true });
        ctx.logger.info(`agent-board: ready at ${DEFAULT_BASE_PATH}`);
      },
    });
  },
};

export default plugin;
