import type { OrchestrationV2ProjectedTurnItem, RunId } from "@t3tools/contracts";
import { resolveT3McpToolDefinition } from "@t3tools/shared/t3McpToolPresentation";

type TurnRow = Pick<OrchestrationV2ProjectedTurnItem, "visibility" | "item">;

const STEP_MAX_LENGTH = 80;

function firstLine(text: string): string {
  const line = text.trim().split("\n", 1)[0]!.trim();
  return line.length > STEP_MAX_LENGTH ? `${line.slice(0, STEP_MAX_LENGTH - 1)}…` : line;
}

/**
 * A few words on what a working agent is doing, from its newest item of its
 * own; items inherited from another thread (a delegated child's parent) are
 * skipped. With a run id, it stops at the first item of an earlier run: right
 * after a send the newest items are still the previous run's.
 */
export function describeAgentStep(items: ReadonlyArray<TurnRow>, runId?: RunId): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const { item, visibility } = items[index]!;
    if (visibility !== "local") continue;
    if (runId !== undefined && item.runId !== runId) return null;
    switch (item.type) {
      case "file_change":
        return `Editing ${item.fileName.split("/").at(-1)}`;
      case "command_execution":
        return `Running ${firstLine(item.input)}`;
      case "assistant_message": {
        const line = firstLine(item.text);
        if (line) return line;
        continue;
      }
      case "reasoning":
        return "Thinking";
      case "web_search":
        return "Searching the web";
      case "file_search":
        return "Searching files";
      case "dynamic_tool": {
        const t3Labels = resolveT3McpToolDefinition(item.toolName)?.labels;
        return item.title?.trim() || (t3Labels ? `${t3Labels[1]} ${t3Labels[3]}` : "Using a tool");
      }
      case "user_message":
        // The request is the newest item: the agent has not started on it.
        return null;
      default:
        continue;
    }
  }
  return null;
}
