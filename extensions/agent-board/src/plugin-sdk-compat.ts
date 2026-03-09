import { Type } from "@sinclair/typebox";

type StringEnumOptions<T extends readonly string[]> = {
  description?: string;
  title?: string;
  default?: T[number];
};

export type AgentBoardPluginApi = {
  pluginConfig?: unknown;
  resolvePath: (input: string) => string;
  registerTool: (
    factory: (ctx: AgentBoardPluginToolContext) => unknown,
    options: { names: readonly string[] },
  ) => void;
  registerHttpHandler: (handler: unknown) => void;
  registerService: (service: {
    id: string;
    start: (ctx: { logger: { info: (message: string) => void } }) => void;
  }) => void;
};

export type AgentBoardPluginToolContext = {
  agentId?: string;
  sessionKey?: string;
  agentAccountId?: string;
  messageChannel?: string;
};

export type AgentBoardPluginToolResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
  details: unknown;
};

export function jsonResult(payload: unknown): AgentBoardPluginToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

export function stringEnum<T extends readonly string[]>(
  values: T,
  options: StringEnumOptions<T> = {},
) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...options,
  });
}

export function optionalStringEnum<T extends readonly string[]>(
  values: T,
  options: StringEnumOptions<T> = {},
) {
  return Type.Optional(stringEnum(values, options));
}
