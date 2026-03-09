import type { PluginRuntime } from "./plugin-sdk-compat.js";

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

let _runtime: PluginRuntime | null = null;

function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  const parts = sessionKey.split(":");
  if (parts.length >= 3 && parts[0] === "agent" && parts[1]) {
    return parts[1];
  }
  return null;
}

export function setRuntime(runtime: PluginRuntime): void {
  _runtime = runtime;
}

export function getRuntime(): PluginRuntime | null {
  return _runtime;
}

export function resolveBoardAssigneeSessionKey(assignee: string | undefined): string {
  const trimmed = typeof assignee === "string" ? assignee.trim() : "";
  if (!trimmed) return "";
  if (/^(agent|subagent|acp):/i.test(trimmed)) return trimmed;
  return AGENT_SESSION_MAP[trimmed] || `agent:${trimmed}:main`;
}

export function resolveBoardAssigneeAgentId(assignee: string | undefined): string {
  const sessionKey = resolveBoardAssigneeSessionKey(assignee);
  const agentId = parseAgentIdFromSessionKey(sessionKey);
  const trimmed = typeof assignee === "string" ? assignee.trim() : "";
  return agentId || trimmed;
}

export async function notifyAgent(assignee: string | undefined, message: string): Promise<boolean> {
  if (!assignee) {
    console.warn("[agent-board] notifyAgent: no assignee provided");
    return false;
  }

  if (!_runtime) {
    console.warn("[agent-board] notifyAgent: runtime not set");
    return false;
  }

  const sessionKey = resolveBoardAssigneeSessionKey(assignee);
  if (!sessionKey) {
    console.warn("[agent-board] notifyAgent: could not resolve session key");
    return false;
  }

  try {
    const result = await _runtime.subagent.run({
      sessionKey,
      message,
      deliver: false,
    });

    const agentId = parseAgentIdFromSessionKey(sessionKey) || assignee;
    console.log(`[agent-board] notification sent to ${agentId}, runId: ${result.runId}`);
    return true;
  } catch (error) {
    console.error("[agent-board] notifyAgent error:", error);
    return false;
  }
}

export async function notifyAgentRetrigger(
  assignee: string | undefined,
  taskInfo: { taskId: string; taskTitle: string; retryCount: number; maxRetries: number },
): Promise<boolean> {
  if (!assignee) {
    console.warn("[agent-board] notifyAgentRetrigger: no assignee provided");
    return false;
  }

  if (!_runtime) {
    console.warn("[agent-board] notifyAgentRetrigger: runtime not set");
    return false;
  }

  const sessionKey = resolveBoardAssigneeSessionKey(assignee);
  if (!sessionKey) {
    console.warn("[agent-board] notifyAgentRetrigger: could not resolve session key");
    return false;
  }

  try {
    const result = await _runtime.subagent.run({
      sessionKey,
      message:
        `Task auto-retry #${taskInfo.retryCount}/${taskInfo.maxRetries}\n\n` +
        `Task ID: ${taskInfo.taskId}\n` +
        `Task: ${taskInfo.taskTitle}\n\n` +
        "Please continue working on this task.",
      deliver: false,
    });

    const agentId = parseAgentIdFromSessionKey(sessionKey) || assignee;
    console.log(`[agent-board] retriggered ${agentId}, runId: ${result.runId}`);
    return true;
  } catch (error) {
    console.error("[agent-board] notifyAgentRetrigger error:", error);
    return false;
  }
}
