/**
 * Agent Board - Runtime 存储
 * 
 * 存储插件 runtime 引用，用于发送通知
 */

import type { PluginRuntime } from "./plugin-sdk-compat.js";

let _runtime: PluginRuntime | null = null;

export function setRuntime(runtime: PluginRuntime): void {
  _runtime = runtime;
}

export function getRuntime(): PluginRuntime | null {
  return _runtime;
}

/**
 * 发送消息给指定的 agent session
 */
export async function notifyAgent(agentId: string | undefined, message: string): Promise<boolean> {
  if (!agentId) {
    console.warn('[agent-board] notifyAgent: no agentId provided');
    return false;
  }

  if (!_runtime) {
    console.warn('[agent-board] notifyAgent: runtime not set');
    return false;
  }

  const sessionKey = `agent:${agentId}:main`;

  console.log(`[agent-board] 📤 Notifying agent: ${agentId}`);

  try {
    const result = await _runtime.subagent.run({
      sessionKey,
      message,
      deliver: false,
    });

    console.log(`[agent-board] ✅ Notification sent to ${agentId}, runId: ${result.runId}`);
    return true;
  } catch (error) {
    console.error('[agent-board] notifyAgent error:', error);
    return false;
  }
}

/**
 * 重新触发 agent 执行任务（用于自动重试）
 */
export async function notifyAgentRetrigger(
  agentId: string | undefined, 
  taskInfo: { taskId: string; taskTitle: string; retryCount: number; maxRetries: number }
): Promise<boolean> {
  if (!agentId) {
    console.warn('[agent-board] notifyAgentRetrigger: no agentId provided');
    return false;
  }

  if (!_runtime) {
    console.warn('[agent-board] notifyAgentRetrigger: runtime not set');
    return false;
  }

  const sessionKey = `agent:${agentId}:main`;

  console.log(`[agent-board] 🔄 Retriggering agent: ${agentId} for task: ${taskInfo.taskTitle}`);

  try {
    const result = await _runtime.subagent.run({
      sessionKey,
      message: 
        `🔄 任务自动重试 #${taskInfo.retryCount}/${taskInfo.maxRetries}\n\n` +
        `**任务ID**: ${taskInfo.taskId}\n` +
        `**任务**: ${taskInfo.taskTitle}\n\n` +
        `请继续执行这个任务。`,
      deliver: false,
    });

    console.log(`[agent-board] ✅ Retriggered ${agentId}, runId: ${result.runId}`);
    return true;
  } catch (error) {
    console.error('[agent-board] notifyAgentRetrigger error:', error);
    return false;
  }
}
