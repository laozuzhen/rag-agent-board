import * as store from "./store.js";
import { generateId, now } from "./utils.js";
import { Task, TaskColumn } from "./types.js";
import { notifyAgent, notifyAgentRetrigger } from "./runtime.js";

export interface MoveResult {
  task: Task;
  retried: boolean;
  chainedTask?: Task;
  error?: string;
}

const VALID_COLUMNS: TaskColumn[] = ["backlog", "todo", "doing", "review", "done", "failed"];

export async function moveTask(taskId: string, column: TaskColumn): Promise<MoveResult | { error: string; requiresReview?: boolean }> {
  if (!column) return { error: "column is required" };
  if (!VALID_COLUMNS.includes(column)) return { error: `column must be one of: ${VALID_COLUMNS.join(", ")}` };

  const current = store.getTask(taskId);
  if (!current) return { error: "Task not found" };

  // Dependency gate: when moving to "doing", check all dependencies are in "done"
  if (column === "doing" && current.dependencies.length > 0) {
    const blockers: { id: string; title: string; column: string }[] = [];
    for (const depId of current.dependencies) {
      const dep = store.getTask(depId);
      if (dep && dep.column !== "done") {
        blockers.push({ id: dep.id, title: dep.title, column: dep.column });
      }
    }
    if (blockers.length > 0) {
      return {
        error: `Blocked by unresolved dependencies: ${blockers.map(b => `"${b.title}" (${b.id}, status: ${b.column})`).join(", ")}`,
      };
    }
  }

  // Quality gate: if requiresReview and trying to go straight to done from doing
  if (column === "done" && current.requiresReview && current.column !== "review") {
    return {
      error: "Quality gate: this task requires review before done. Move to 'review' first.",
      requiresReview: true,
    };
  }

  // Build update payload with metrics
  const updates: Partial<Task> = { column };

  // Track startedAt (first time moving to "doing")
  if (column === "doing" && !current.startedAt) {
    updates.startedAt = now();
  }

  // Track completedAt and compute duration
  if (column === "done") {
    updates.completedAt = now();
    if (current.startedAt) {
      updates.durationMs = new Date(updates.completedAt).getTime() - new Date(current.startedAt).getTime();
    }
  }

  // Track failedAt
  if (column === "failed") {
    updates.failedAt = now();
  }

  const updated = await store.updateTask(taskId, updates);
  if (!updated) return { error: "Task not found" };

  // Auto-retry: if moved to "failed" and retries remaining
  let retried = false;
  if (column === "failed") {
    const retryCount = (updated.retryCount || 0);
    const maxRetries = updated.maxRetries ?? 2;
    if (retryCount < maxRetries) {
      const retryUpdates: Partial<Task> = {
        column: "todo",
        retryCount: retryCount + 1,
        failedAt: undefined,
      };
      await store.updateTask(updated.id, retryUpdates);
      await store.addComment(updated.id, {
        author: "system",
        text: `Auto-retry ${retryCount + 1}/${maxRetries}: task moved back to todo after failure.`,
      });
      retried = true;
      
      // 🔔 直接重新触发 assignee 执行任务
      notifyAgentRetrigger(updated.assignee, {
        taskId: updated.id,
        taskTitle: updated.title,
        retryCount: retryCount + 1,
        maxRetries,
      }).catch(err => 
        console.error('[agent-board] notifyAgentRetrigger error:', err)
      );
    } else {
      await store.addComment(updated.id, {
        author: "system",
        text: `Max retries (${maxRetries}) exhausted. Task requires manual intervention.`,
      });
      
      // 🔔 通知 main agent（管理员）需要人工干预
      notifyAgent("main", 
        `⚠️ 任务需要人工干预\n\n` +
        `**任务**: ${updated.title}\n` +
        `**ID**: ${updated.id}\n` +
        `**Assignee**: ${updated.assignee}\n` +
        `**重试次数**: ${maxRetries}/${maxRetries} 已用尽\n\n` +
        `请在 agent-board 中查看并处理。`
      ).catch(err => 
        console.error('[agent-board] notifyAgent (main) error:', err)
      );
    }
  }

  // Auto-notify dependents: if moved to "done", find tasks that depend on this one
  if (column === "done") {
    const allTasks = store.getTasks({});
    for (const t of allTasks) {
      if (t.dependencies.includes(taskId)) {
        await store.addComment(t.id, {
          author: "system",
          text: `Dependency resolved: "${updated.title}" (${updated.id}) is now done.`,
        });
        
        // 🔔 通知依赖者的 assignee 依赖已解决
        const allDepsDone = t.dependencies.every(depId => {
          const dep = store.getTask(depId);
          return dep && dep.column === "done";
        });
        
        if (allDepsDone) {
          notifyAgent(t.assignee,
            `✅ 任务依赖已解决，可以开始执行\n\n` +
            `**任务**: ${t.title}\n` +
            `**ID**: ${t.id}\n\n` +
            `所有前置依赖已完成。`
          ).catch(err => 
            console.error('[agent-board] notifyDependenciesResolved error:', err)
          );
        }
      }
    }
  }

  // Auto-chain: if moved to "done" and has nextTask, create it
  let spawned: Task | undefined;
  if (column === "done" && updated.nextTask) {
    const nt = updated.nextTask;
    const chainedTask: Task = {
      id: generateId("task"),
      projectId: updated.projectId,
      title: nt.title,
      description: nt.description || `Chained from: ${updated.title} (${updated.id})`,
      status: "todo",
      column: "todo",
      assignee: nt.assignee,
      createdBy: updated.assignee,
      priority: nt.priority || updated.priority,
      tags: nt.tags || updated.tags,
      dependencies: [],
      subtasks: [],
      comments: [{
        author: "system",
        text: `Auto-created from completed task "${updated.title}" (${updated.id})`,
        at: now(),
      }],
      parentTaskId: updated.id,
      createdAt: now(),
      updatedAt: now(),
    };
    spawned = await store.createTask(chainedTask);
    
    // 🔔 通知新任务的 assignee
    if (spawned) {
      notifyAgent(spawned.assignee,
        `🔗 新任务已自动创建\n\n` +
        `**任务**: ${spawned.title}\n` +
        `**ID**: ${spawned.id}\n` +
        `**来源**: ${updated.title}\n\n` +
        `这是前置任务完成后自动创建的后续任务。`
      ).catch(err => 
        console.error('[agent-board] notifyChainedTaskCreated error:', err)
      );
    }
  }

  return { task: updated, retried, ...(spawned ? { chainedTask: spawned } : {}) };
}
