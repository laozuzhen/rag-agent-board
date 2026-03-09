import { createHmac, randomUUID } from "node:crypto";

import type { Task } from "./types.js";

// NOTE: This extension is intended to be bundled with Moltbot/OpenClaw.
// In source checkouts, internals live under src/.
// In built installs, they live under the package root.

type CallGatewayFn = <T = unknown>(opts: {
  method: string;
  params?: unknown;
  expectFinal?: boolean;
  timeoutMs?: number;
  url?: string;
  token?: string;
  password?: string;
}) => Promise<T>;

type BuildAgentMainSessionKeyFn = (params: {
  agentId: string;
  mainKey?: string | undefined;
}) => string;

let callGatewayPromise: Promise<CallGatewayFn> | null = null;
let buildAgentMainSessionKeyPromise: Promise<BuildAgentMainSessionKeyFn> | null = null;

async function loadCallGateway(): Promise<CallGatewayFn> {
  if (callGatewayPromise) return callGatewayPromise;
  callGatewayPromise = (async () => {
    try {
      const mod = await import("../../../src/gateway/call.js");
      if (typeof (mod as { callGateway?: unknown }).callGateway === "function") {
        return (mod as { callGateway: CallGatewayFn }).callGateway;
      }
    } catch {
      // ignore source-path miss in bundled installs
    }

    const mod = await import("../../../gateway/call.js");
    if (typeof (mod as { callGateway?: unknown }).callGateway !== "function") {
      throw new Error("Internal error: callGateway not available");
    }
    return (mod as { callGateway: CallGatewayFn }).callGateway;
  })();
  return callGatewayPromise;
}

async function loadBuildAgentMainSessionKey(): Promise<BuildAgentMainSessionKeyFn> {
  if (buildAgentMainSessionKeyPromise) return buildAgentMainSessionKeyPromise;
  buildAgentMainSessionKeyPromise = (async () => {
    try {
      const mod = await import("../../../src/routing/session-key.js");
      if (
        typeof (mod as { buildAgentMainSessionKey?: unknown }).buildAgentMainSessionKey ===
        "function"
      ) {
        return (mod as { buildAgentMainSessionKey: BuildAgentMainSessionKeyFn })
          .buildAgentMainSessionKey;
      }
    } catch {
      // ignore source-path miss in bundled installs
    }

    const mod = await import("../../../routing/session-key.js");
    if (
      typeof (mod as { buildAgentMainSessionKey?: unknown }).buildAgentMainSessionKey !==
      "function"
    ) {
      throw new Error("Internal error: buildAgentMainSessionKey not available");
    }
    return (mod as { buildAgentMainSessionKey: BuildAgentMainSessionKeyFn })
      .buildAgentMainSessionKey;
  })();
  return buildAgentMainSessionKeyPromise;
}

const OPENCLAW_HOOK_URL = process.env.OPENCLAW_HOOK_URL || "http://localhost:18789/hooks/agent";
const OPENCLAW_HOOK_TOKEN = process.env.OPENCLAW_HOOK_TOKEN || "";
const DEFAULT_NOTIFY_TIMEOUT_MS = 10_000;

function getHookToken(): string {
  return process.env.OPENCLAW_HOOK_TOKEN || OPENCLAW_HOOK_TOKEN;
}

function getWebhookSecret(): string {
  return process.env.AGENTBOARD_WEBHOOK_SECRET || getHookToken();
}

function getNotifyTimeoutMs(): number {
  const raw = process.env.AGENTBOARD_NOTIFY_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_NOTIFY_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_NOTIFY_TIMEOUT_MS;
  return Math.floor(parsed);
}

export function signPayload(
  body: Record<string, unknown>,
  secret: string,
): { signature: string; timestamp: number } {
  const timestamp = Date.now();
  const bodyWithTimestamp = { ...body, timestamp };
  const raw = JSON.stringify(bodyWithTimestamp);
  const hmac = createHmac("sha256", secret).update(raw).digest("hex");
  return { signature: `sha256=${hmac}`, timestamp };
}

const AGENT_SESSION_MAP: Record<string, string> = {
  jarvx: "agent:main:main",
  eff: "agent:eff:main",
  agency: "agent:agency:main",
  "auteur-augmente": "agent:auteur-augmente:main",
  "content-creator": "agent:content:main",
  "sales-agent": "agent:sales:main",
  "research-agent": "agent:research:main",
  "coding-agent": "agent:coding:main",
  support: "agent:support:main",
  onboarding: "agent:onboarding:main",
  community: "agent:community:main",
  ops: "agent:ops:main",
  "infra-agent": "agent:infra:main",
};

function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  const parts = sessionKey.split(":");
  if (parts.length >= 3 && parts[0] === "agent" && parts[1]) {
    return parts[1];
  }
  return null;
}

function resolveMappedAgentId(assignee: string): string {
  const trimmed = assignee.trim();
  if (!trimmed) return trimmed;
  const mappedSessionKey = AGENT_SESSION_MAP[trimmed];
  const explicitSessionKey = /^(agent|subagent|acp):/i.test(trimmed) ? trimmed : undefined;
  const sessionKey = mappedSessionKey || explicitSessionKey;
  return sessionKey ? (parseAgentIdFromSessionKey(sessionKey) ?? trimmed) : trimmed;
}

export async function resolveBoardAssigneeSessionKey(assignee: string): Promise<string> {
  const trimmed = assignee.trim();
  if (!trimmed) return "";
  if (/^(agent|subagent|acp):/i.test(trimmed)) return trimmed;
  const mappedSessionKey = AGENT_SESSION_MAP[trimmed];
  if (mappedSessionKey) return mappedSessionKey;
  const buildAgentMainSessionKey = await loadBuildAgentMainSessionKey();
  return buildAgentMainSessionKey({ agentId: trimmed });
}

export function buildTaskNotificationMessage(task: Task, context?: string): string {
  return [
    `[AgentBoard] Task: ${task.title} (${task.id})`,
    context ? `Contexte: ${context}` : "",
    task.description ? `Brief: ${task.description.slice(0, 300)}` : "",
    "",
    "Check ton board et traite cette task.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function notifyAgentViaGateway(task: Task, message: string): Promise<boolean> {
  const sessionKey = await resolveBoardAssigneeSessionKey(task.assignee);
  if (!sessionKey) return false;
  const callGateway = await loadCallGateway();
  await callGateway({
    method: "chat.send",
    params: {
      sessionKey,
      message,
      idempotencyKey: randomUUID(),
    },
    timeoutMs: getNotifyTimeoutMs(),
  });
  return true;
}

async function notifyAgentViaHook(task: Task, message: string, event?: string): Promise<boolean> {
  const hookToken = getHookToken();
  if (!hookToken) return false;
  const agentName = task.assignee?.trim();
  if (!agentName) return false;

  const basePayload: Record<string, unknown> = {
    agent: resolveMappedAgentId(agentName),
    message,
    wakeMode: "now",
    source: "agentboard",
    taskId: task.id,
    event: event || undefined,
  };

  const secret = getWebhookSecret();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${hookToken}`,
  };

  let finalPayload: Record<string, unknown>;
  if (secret) {
    const { signature, timestamp } = signPayload(basePayload, secret);
    finalPayload = { ...basePayload, timestamp, signature };
    headers["X-AgentBoard-Signature"] = signature;
    headers["X-AgentBoard-Timestamp"] = String(timestamp);
    headers["X-AgentBoard-Source"] = "agentboard";
  } else {
    finalPayload = basePayload;
  }

  const res = await fetch(OPENCLAW_HOOK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(finalPayload),
  });
  return res.ok;
}

export async function notifyAgent(task: Task, context?: string, event?: string): Promise<boolean> {
  const agentName = task.assignee?.trim();
  if (!agentName) return false;
  const message = buildTaskNotificationMessage(task, context);

  try {
    return await notifyAgentViaGateway(task, message);
  } catch (err) {
    console.warn(`[agent-board] gateway notify failed for ${agentName}:`, err);
  }

  try {
    return await notifyAgentViaHook(task, message, event);
  } catch (err) {
    console.error(`[agent-board] webhook notify failed for ${agentName}:`, err);
    return false;
  }
}

