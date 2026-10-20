import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type OrchestrationV2TurnItem, ThreadId } from "@t3tools/contracts";
import { resolveT3McpToolDefinition } from "@t3tools/shared/t3McpToolPresentation";

import { useThreadShell } from "~/state/entities";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The thread a T3 tool call acts on, when its input names one. */
export function t3ToolArgsThreadId(toolName: string | null, args: unknown): string | null {
  if (resolveT3McpToolDefinition(toolName) === null) return null;
  const threadId = asRecord(args)?.threadId;
  return typeof threadId === "string" && threadId.trim() !== "" ? threadId.trim() : null;
}

function formatTimeout(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/**
 * A T3 tool call's input as a person reads it: the target thread by title, a
 * timeout in minutes, and no idempotency key. Other tools pass through as is.
 */
export function readableT3ToolArgs(
  toolName: string | null,
  args: unknown,
  threadTitle: string | null,
): unknown {
  const record = asRecord(args);
  if (record === null || resolveT3McpToolDefinition(toolName) === null) return args;
  const readable: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "clientRequestId") continue;
    if (key === "threadId" && threadTitle !== null) readable.thread = threadTitle;
    else if (key === "timeoutMs" && typeof value === "number" && value > 0) {
      readable.timeout = formatTimeout(value);
    } else readable[key] = value;
  }
  return readable;
}

export function useReadableT3ToolArgs(
  item: OrchestrationV2TurnItem,
  environmentId: EnvironmentId,
): unknown {
  const toolName = item.type === "dynamic_tool" ? item.toolName : null;
  const args = item.type === "dynamic_tool" ? item.input : undefined;
  const threadId = t3ToolArgsThreadId(toolName, args);
  const shell = useThreadShell(
    threadId === null ? null : scopeThreadRef(environmentId, ThreadId.make(threadId)),
  );
  return readableT3ToolArgs(toolName, args, shell?.title.trim() || null);
}
