import { Type } from "@sinclair/typebox";
import type { AgentBoardPluginApi, AgentBoardPluginToolContext } from "./plugin-sdk-compat.js";
import { jsonResult, optionalStringEnum, stringEnum } from "./plugin-sdk-compat.js";

import { appendAuditLog } from "./audit.js";
import { moveTask } from "./services.js";
import * as store from "./store.js";
import type { NextTask, Task, TaskColumn, TaskPriority } from "./types.js";
import { generateId, now } from "./utils.js";

const TASK_COLUMN_VALUES = ["backlog", "todo", "doing", "review", "done", "failed"] as const;
const TASK_PRIORITY_VALUES = ["low", "medium", "high", "urgent"] as const;
const PROJECT_STATUS_VALUES = ["active", "archived"] as const;

const ColumnSchema = stringEnum(TASK_COLUMN_VALUES, {
  description: `Board column: ${TASK_COLUMN_VALUES.join(", ")}`,
});
const OptionalColumnSchema = optionalStringEnum(TASK_COLUMN_VALUES, {
  description: `Board column: ${TASK_COLUMN_VALUES.join(", ")}`,
});
const OptionalPrioritySchema = optionalStringEnum(TASK_PRIORITY_VALUES, {
  description: `Task priority: ${TASK_PRIORITY_VALUES.join(", ")}`,
});
const OptionalProjectStatusSchema = optionalStringEnum(PROJECT_STATUS_VALUES, {
  description: `Project status: ${PROJECT_STATUS_VALUES.join(", ")}`,
});

const NextTaskSchema = Type.Object(
  {
    title: Type.String(),
    description: Type.Optional(Type.String()),
    assignee: Type.String(),
    priority: OptionalPrioritySchema,
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

function actorFromContext(ctx: AgentBoardPluginToolContext): string {
  return ctx.agentId || ctx.sessionKey || ctx.agentAccountId || ctx.messageChannel || "plugin";
}

type ToolAuditEntry = Omit<Parameters<typeof appendAuditLog>[0], "agentId"> & { agentId?: string };

function audit(ctx: AgentBoardPluginToolContext, payload: ToolAuditEntry) {
  appendAuditLog({ ...payload, agentId: payload.agentId || actorFromContext(ctx) });
}

function changedFields(params: Record<string, unknown>, ignored: string[] = ["id"]): string {
  return Object.keys(params)
    .filter((key) => !ignored.includes(key))
    .join(", ");
}

function normalizeTaskColumn(params: { column?: TaskColumn; status?: TaskColumn }): TaskColumn | undefined {
  return params.column ?? params.status;
}

export const AGENT_BOARD_TOOL_NAMES = [
  "board_list_projects",
  "board_get_project",
  "board_create_project",
  "board_update_project",
  "board_create_task",
  "board_update_task",
  "board_move_task",
  "board_add_comment",
  "board_list_comments",
  "board_get_task_thread",
  "board_list_tasks",
  "board_my_tasks",
  "board_delete_task",
  "board_delete_project",
] as const;

type ListProjectsParams = {
  status?: (typeof PROJECT_STATUS_VALUES)[number];
  owner?: string;
};

type GetProjectParams = { id: string };

type CreateProjectParams = {
  name: string;
  owner?: string;
  description?: string;
  clientViewEnabled?: boolean;
};

type UpdateProjectParams = {
  id: string;
  name?: string;
  status?: (typeof PROJECT_STATUS_VALUES)[number];
  owner?: string;
  description?: string;
  clientViewEnabled?: boolean;
};

type CreateTaskParams = {
  projectId: string;
  title: string;
  description?: string;
  assignee?: string;
  createdBy?: string;
  priority?: TaskPriority;
  tags?: string[];
  column?: TaskColumn;
  nextTask?: NextTask;
  parentTaskId?: string;
  requiresReview?: boolean;
  maxRetries?: number;
  deadline?: string;
  inputPath?: string;
  outputPath?: string;
  dependencies?: string[];
};

type UpdateTaskParams = {
  id: string;
  title?: string;
  description?: string;
  assignee?: string;
  priority?: TaskPriority;
  tags?: string[];
  column?: TaskColumn;
  status?: TaskColumn;
  nextTask?: NextTask;
  parentTaskId?: string;
  requiresReview?: boolean;
  maxRetries?: number;
  deadline?: string;
  inputPath?: string;
  outputPath?: string;
  dependencies?: string[];
};

type MoveTaskParams = {
  id: string;
  column: TaskColumn;
};

type AddCommentParams = {
  taskId: string;
  author?: string;
  text: string;
};

type TaskIdParams = {
  taskId: string;
};

type ListTasksParams = {
  projectId?: string;
  assignee?: string;
  status?: TaskColumn;
  tag?: string;
};

type MyTasksParams = {
  agentId?: string;
};

type DeleteByIdParams = {
  id: string;
};

export function createAgentBoardTools(_api: AgentBoardPluginApi, ctx: AgentBoardPluginToolContext) {
  return [
    {
      name: "board_list_projects",
      label: "Board List Projects",
      description: "List board projects with optional status or owner filters.",
      parameters: Type.Object(
        {
          status: OptionalProjectStatusSchema,
          owner: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId: string, params: ListProjectsParams) {
        return jsonResult(store.getProjects(params));
      },
    },
    {
      name: "board_get_project",
      label: "Board Get Project",
      description: "Get a project and all tasks assigned to it.",
      parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }),
      async execute(_toolCallId: string, params: GetProjectParams) {
        const project = store.getProject(params.id);
        if (!project) return jsonResult({ error: "Project not found" });
        return jsonResult({ ...project, tasks: store.getTasks({ projectId: params.id }) });
      },
    },
    {
      name: "board_create_project",
      label: "Board Create Project",
      description: "Create a new project in the board.",
      parameters: Type.Object(
        {
          name: Type.String(),
          owner: Type.Optional(Type.String()),
          description: Type.Optional(Type.String()),
          clientViewEnabled: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId: string, params: CreateProjectParams) {
        const timestamp = now();
        const project = await store.createProject({
          id: generateId("proj"),
          name: params.name,
          status: "active",
          owner: params.owner || actorFromContext(ctx),
          description: params.description || "",
          clientViewEnabled: params.clientViewEnabled,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        audit(ctx, {
          timestamp,
          action: "project.create",
          projectId: project.id,
          details: `Created project "${project.name}"`,
        });
        return jsonResult(project);
      },
    },
    {
      name: "board_update_project",
      label: "Board Update Project",
      description: "Update project fields.",
      parameters: Type.Object(
        {
          id: Type.String(),
          name: Type.Optional(Type.String()),
          status: OptionalProjectStatusSchema,
          owner: Type.Optional(Type.String()),
          description: Type.Optional(Type.String()),
          clientViewEnabled: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId: string, params: UpdateProjectParams) {
        const project = await store.updateProject(params.id, {
          name: params.name,
          status: params.status,
          owner: params.owner,
          description: params.description,
          clientViewEnabled: params.clientViewEnabled,
        });
        if (!project) return jsonResult({ error: "Project not found" });
        audit(ctx, {
          timestamp: now(),
          action: "project.update",
          projectId: params.id,
          details: `Updated project fields: ${changedFields(params)}`,
        });
        return jsonResult(project);
      },
    },
    {
      name: "board_create_task",
      label: "Board Create Task",
      description: "Create a new task in a project.",
      parameters: Type.Object(
        {
          projectId: Type.String(),
          title: Type.String(),
          description: Type.Optional(Type.String()),
          assignee: Type.Optional(Type.String()),
          createdBy: Type.Optional(Type.String()),
          priority: OptionalPrioritySchema,
          tags: Type.Optional(Type.Array(Type.String())),
          column: OptionalColumnSchema,
          nextTask: Type.Optional(NextTaskSchema),
          parentTaskId: Type.Optional(Type.String()),
          requiresReview: Type.Optional(Type.Boolean()),
          maxRetries: Type.Optional(Type.Integer({ minimum: 0 })),
          deadline: Type.Optional(Type.String()),
          inputPath: Type.Optional(Type.String()),
          outputPath: Type.Optional(Type.String()),
          dependencies: Type.Optional(Type.Array(Type.String())),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId: string, params: CreateTaskParams) {
        const timestamp = now();
        const column = params.column || "backlog";
        const task: Task = {
          id: generateId("task"),
          projectId: params.projectId,
          title: params.title,
          description: params.description || "",
          status: column,
          column,
          assignee: params.assignee || actorFromContext(ctx),
          createdBy: params.createdBy || actorFromContext(ctx),
          priority: params.priority || "medium",
          tags: params.tags || [],
          dependencies: params.dependencies || [],
          subtasks: [],
          comments: [],
          nextTask: params.nextTask,
          parentTaskId: params.parentTaskId,
          requiresReview: params.requiresReview,
          maxRetries: params.maxRetries,
          deadline: params.deadline,
          inputPath: params.inputPath,
          outputPath: params.outputPath,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const created = await store.createTask(task);
        audit(ctx, {
          timestamp,
          action: "task.create",
          taskId: created.id,
          projectId: created.projectId,
          details: `Created task "${created.title}"`,
        });
        return jsonResult(created);
      },
    },
    {
      name: "board_update_task",
      label: "Board Update Task",
      description: "Update task fields like assignee, priority, dependencies, or board state.",
      parameters: Type.Object(
        {
          id: Type.String(),
          title: Type.Optional(Type.String()),
          description: Type.Optional(Type.String()),
          assignee: Type.Optional(Type.String()),
          priority: OptionalPrioritySchema,
          tags: Type.Optional(Type.Array(Type.String())),
          column: OptionalColumnSchema,
          status: OptionalColumnSchema,
          nextTask: Type.Optional(NextTaskSchema),
          parentTaskId: Type.Optional(Type.String()),
          requiresReview: Type.Optional(Type.Boolean()),
          maxRetries: Type.Optional(Type.Integer({ minimum: 0 })),
          deadline: Type.Optional(Type.String()),
          inputPath: Type.Optional(Type.String()),
          outputPath: Type.Optional(Type.String()),
          dependencies: Type.Optional(Type.Array(Type.String())),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId: string, params: UpdateTaskParams) {
        const task = await store.updateTask(params.id, {
          title: params.title,
          description: params.description,
          assignee: params.assignee,
          priority: params.priority,
          tags: params.tags,
          column: normalizeTaskColumn(params),
          nextTask: params.nextTask,
          parentTaskId: params.parentTaskId,
          requiresReview: params.requiresReview,
          maxRetries: params.maxRetries,
          deadline: params.deadline,
          inputPath: params.inputPath,
          outputPath: params.outputPath,
          dependencies: params.dependencies,
        });
        if (!task) return jsonResult({ error: "Task not found" });
        audit(ctx, {
          timestamp: now(),
          action: "task.update",
          taskId: task.id,
          projectId: task.projectId,
          details: `Updated task fields: ${changedFields(params)}`,
        });
        return jsonResult(task);
      },
    },
    {
      name: "board_move_task",
      label: "Board Move Task",
      description: "Move a task between board columns.",
      parameters: Type.Object(
        {
          id: Type.String(),
          column: ColumnSchema,
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId: string, params: MoveTaskParams) {
        const taskBefore = store.getTask(params.id);
        const result = await moveTask(params.id, params.column);
        if ("error" in result && !("task" in result)) return jsonResult(result);
        audit(ctx, {
          timestamp: now(),
          action: "task.move",
          taskId: params.id,
          projectId: taskBefore?.projectId,
          from: taskBefore?.column,
          to: params.column,
          details: `Moved task from ${taskBefore?.column || "unknown"} to ${params.column}`,
        });
        return jsonResult(result);
      },
    },
    {
      name: "board_add_comment",
      label: "Board Add Comment",
      description: "Add a comment to a task thread.",
      parameters: Type.Object(
        {
          taskId: Type.String(),
          author: Type.Optional(Type.String()),
          text: Type.String(),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId: string, params: AddCommentParams) {
        const author = params.author || actorFromContext(ctx);
        const task = await store.addComment(params.taskId, { author, text: params.text });
        if (!task) return jsonResult({ error: "Task not found" });
        audit(ctx, {
          timestamp: now(),
          action: "comment.add",
          taskId: task.id,
          projectId: task.projectId,
          details: `Comment by ${author}: ${params.text.slice(0, 100)}`,
        });
        return jsonResult(task);
      },
    },
    {
      name: "board_list_comments",
      label: "Board List Comments",
      description: "List comments for a task.",
      parameters: Type.Object({ taskId: Type.String() }, { additionalProperties: false }),
      async execute(_toolCallId: string, params: TaskIdParams) {
        const task = store.getTask(params.taskId);
        if (!task) return jsonResult({ error: "Task not found" });
        return jsonResult(task.comments);
      },
    },
    {
      name: "board_get_task_thread",
      label: "Board Get Task Thread",
      description: "Get a task summary plus all comments.",
      parameters: Type.Object({ taskId: Type.String() }, { additionalProperties: false }),
      async execute(_toolCallId: string, params: TaskIdParams) {
        const task = store.getTask(params.taskId);
        if (!task) return jsonResult({ error: "Task not found" });
        return jsonResult({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.column,
          assignee: task.assignee,
          priority: task.priority,
          tags: task.tags,
          comments: task.comments,
        });
      },
    },
    {
      name: "board_list_tasks",
      label: "Board List Tasks",
      description: "List tasks with optional project, assignee, status, or tag filters.",
      parameters: Type.Object(
        {
          projectId: Type.Optional(Type.String()),
          assignee: Type.Optional(Type.String()),
          status: OptionalColumnSchema,
          tag: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      async execute(_toolCallId: string, params: ListTasksParams) {
        return jsonResult(store.getTasks(params));
      },
    },
    {
      name: "board_my_tasks",
      label: "Board My Tasks",
      description: "List tasks assigned to the current or specified agent.",
      parameters: Type.Object({ agentId: Type.Optional(Type.String()) }, { additionalProperties: false }),
      async execute(_toolCallId: string, params: MyTasksParams) {
        return jsonResult(store.getTasks({ assignee: params.agentId || actorFromContext(ctx) }));
      },
    },
    {
      name: "board_delete_task",
      label: "Board Delete Task",
      description: "Delete a task by ID.",
      parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }),
      async execute(_toolCallId: string, params: DeleteByIdParams) {
        const task = store.getTask(params.id);
        const deleted = await store.deleteTask(params.id);
        if (!deleted) return jsonResult({ error: "Task not found" });
        audit(ctx, {
          timestamp: now(),
          action: "task.delete",
          taskId: params.id,
          projectId: task?.projectId,
          details: `Deleted task "${task?.title || params.id}"`,
        });
        return jsonResult({ ok: true, deletedId: params.id });
      },
    },
    {
      name: "board_delete_project",
      label: "Board Delete Project",
      description: "Delete a project and all its tasks.",
      parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }),
      async execute(_toolCallId: string, params: DeleteByIdParams) {
        const project = store.getProject(params.id);
        const deleted = await store.deleteProject(params.id);
        if (!deleted) return jsonResult({ error: "Project not found" });
        audit(ctx, {
          timestamp: now(),
          action: "project.delete",
          projectId: params.id,
          details: `Deleted project "${project?.name || params.id}"`,
        });
        return jsonResult({ ok: true, deletedId: params.id });
      },
    },
  ];
}


