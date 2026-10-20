import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import * as DateTime from "effect/DateTime";

import { cn } from "~/lib/utils";

/**
 * Why a failed tool row failed, in a word. Tool output stays on the server, but
 * a call the provider never ran (a hook or permission rule blocked it, or it
 * was cancelled) says so on the item itself.
 */
export function toolFailureTag(item: OrchestrationV2TurnItem | undefined): string {
  switch (item?.toolNonExecutionKind) {
    case undefined:
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "permission-rule":
      return "Blocked";
    default:
      return "Didn't run";
  }
}

/** How long a finished thought took, or null while it runs or when it was instant. */
export function reasoningDuration(item: OrchestrationV2TurnItem | undefined): string | null {
  if (item?.type !== "reasoning" || item.status !== "completed") return null;
  if (!item.startedAt || !item.completedAt) return null;
  const ms = DateTime.toEpochMillis(item.completedAt) - DateTime.toEpochMillis(item.startedAt);
  if (ms < 1_000) return null;
  return ms < 60_000 ? `${Math.round(ms / 1_000)}s` : formatDuration(ms);
}

export function WorkRowTag(props: { readonly text: string; readonly tone: "muted" | "failed" }) {
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap text-xs tabular-nums",
        props.tone === "failed" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {props.text}
    </span>
  );
}
