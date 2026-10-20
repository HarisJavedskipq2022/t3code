import type { OrchestrationV2ProjectedTurnItem, RunId, ThreadId } from "@t3tools/contracts";
import { resolveT3McpToolSummaryAction } from "@t3tools/shared/t3McpToolPresentation";

import { threadReadTargetId } from "./MessagesTimeline.logic";

/**
 * Whether the lead's current step is a wait on its sidekick. The sidekick banner
 * already shows that work, so the lead's own working row would only repeat it.
 */
export function leadIsWaitingOnSidekick(
  items: ReadonlyArray<Pick<OrchestrationV2ProjectedTurnItem, "visibility" | "item">>,
  sidekickThreadId: ThreadId,
  runId: RunId,
): boolean {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const { item, visibility } = items[index]!;
    if (visibility !== "local") continue;
    if (item.runId !== runId || item.type !== "dynamic_tool" || item.status !== "running") {
      return false;
    }
    return (
      resolveT3McpToolSummaryAction(item.toolName) === "thread-wait" &&
      threadReadTargetId({ structuredPayload: item }) === sidekickThreadId
    );
  }
  return false;
}
