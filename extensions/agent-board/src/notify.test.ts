import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "./types.js";

vi.mock("../../../src/gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

import { callGateway } from "../../../src/gateway/call.js";
import { notifyAgent, resolveBoardAssigneeSessionKey } from "./notify.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    projectId: "proj_1",
    title: "Test task",
    description: "Inspect and fix the issue",
    status: "todo",
    column: "todo",
    assignee: "coding-agent",
    createdBy: "tester",
    priority: "high",
    tags: [],
    dependencies: [],
    subtasks: [],
    comments: [],
    createdAt: "2026-03-09T00:00:00.000Z",
    updatedAt: "2026-03-09T00:00:00.000Z",
    ...overrides,
  };
}

describe("agent-board notify", () => {
  const originalEnv = {
    OPENCLAW_HOOK_TOKEN: process.env.OPENCLAW_HOOK_TOKEN,
    AGENTBOARD_WEBHOOK_SECRET: process.env.AGENTBOARD_WEBHOOK_SECRET,
  };

  const fetchMock = vi.fn();
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.OPENCLAW_HOOK_TOKEN;
    delete process.env.AGENTBOARD_WEBHOOK_SECRET;
    (callGateway as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      runId: "run_1",
      status: "started",
    });
    fetchMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    process.env.OPENCLAW_HOOK_TOKEN = originalEnv.OPENCLAW_HOOK_TOKEN;
    process.env.AGENTBOARD_WEBHOOK_SECRET = originalEnv.AGENTBOARD_WEBHOOK_SECRET;
  });

  it("resolves mapped assignees to explicit main sessions", async () => {
    await expect(resolveBoardAssigneeSessionKey("coding-agent")).resolves.toBe("agent:coding:main");
  });

  it("passes explicit session keys through", async () => {
    await expect(resolveBoardAssigneeSessionKey("agent:custom:main")).resolves.toBe(
      "agent:custom:main",
    );
  });

  it("sends notifications via chat.send to the resolved session key", async () => {
    const ok = await notifyAgent(makeTask(), "Task reassigned to you", "task.assign");

    expect(ok).toBe(true);
    expect(callGateway).toHaveBeenCalledTimes(1);
    const call = (callGateway as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.method).toBe("chat.send");
    expect(call.params.sessionKey).toBe("agent:coding:main");
    expect(call.params.idempotencyKey).toEqual(expect.any(String));
    expect(call.params.message).toContain("[AgentBoard] Task: Test task (task_1)");
    expect(call.params.message).toContain("Contexte: Task reassigned to you");
  });

  it("falls back to the legacy webhook when gateway notify fails", async () => {
    process.env.OPENCLAW_HOOK_TOKEN = "hook-token";
    (callGateway as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("gateway offline"),
    );

    const ok = await notifyAgent(makeTask(), "Please check comments", "comment.add");

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe("http://localhost:18789/hooks/agent");
    expect(init.headers.Authorization).toBe("Bearer hook-token");
    expect(JSON.parse(init.body)).toMatchObject({
      agent: "coding",
      event: "comment.add",
      source: "agentboard",
      taskId: "task_1",
    });
  });
});

