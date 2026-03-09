import { createHmac, randomUUID } from "node:crypto";

import type { Task } from "./types.js";
import {
  getRuntime,
  resolveBoardAssigneeAgentId,
  resolveBoardAssigneeSessionKey,
} from "./runtime.js";

type CallGatewayFn = <T = unknown>(opts: {
  method: string;
  params?: unknown;
  expectFinal?: boolean;
  timeoutMs?: number;
  url?: string;
  token?: string;
  password?: string;
}) => Promise<T>;

let callGatewayPromise: Promise<CallGatewayFn | null> | null = null;

async function loadCallGateway(): Promise<CallGatewayFn | null> {
  if (callGatewayPromise) return callGatewayPromise;
  callGatewayPromise = (async () => {
    for (const candidate of ["../../../src/gateway/call.js", "../../../gateway/call.js"]) {
      try {
        const mod = await import(candidate);
        if (typeof (mod as { callGateway?: unknown }).callGateway === "function") {
          return (mod as { callGateway: CallGatewayFn }).callGateway;
        }
      } catch {
      }
    }
    return null;
  })();
  return callGatewayPromise;
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

async function notifyAgentViaRuntime(task: Task, message: string): Promise<boolean> {
  const runtime = getRuntime();
  if (!runtime) return false;
  const sessionKey = resolveBoardAssigneeSessionKey(task.assignee);
  if (!sessionKey) return false;

  await runtime.subagent.run({
    sessionKey,
    message,
    deliver: false,
  });
  return true;
}

async function notifyAgentViaGateway(task: Task, message: string): Promise<boolean> {
  const sessionKey = resolveBoardAssigneeSessionKey(task.assignee);
  if (!sessionKey) return false;
  const callGateway = await loadCallGateway();
  if (!callGateway) return false;

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

  const agent = resolveBoardAssigneeAgentId(task.assignee);
  if (!agent) return false;

  const basePayload: Record<string, unknown> = {
    agent,
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
  const assignee = task.assignee?.trim();
  if (!assignee) return false;

  const message = buildTaskNotificationMessage(task, context);

  try {
    return await notifyAgentViaRuntime(task, message);
  } catch (error) {
    console.warn(`[agent-board] runtime notify failed for ${assignee}:`, error);
  }

  try {
    return await notifyAgentViaGateway(task, message);
  } catch (error) {
    console.warn(`[agent-board] gateway notify failed for ${assignee}:`, error);
  }

  try {
    return await notifyAgentViaHook(task, message, event);
  } catch (error) {
    console.error(`[agent-board] webhook notify failed for ${assignee}:`, error);
    return false;
  }
}
