import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2Subagent,
  type RunId,
  runtimeRequestNeed,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveT3McpToolSummaryAction } from "@t3tools/shared/t3McpToolPresentation";
import * as DateTime from "effect/DateTime";

import { threadReadTargetId } from "./MessagesTimeline.logic";

export type FusionSidekickActivity = Readonly<{
  /** `approval` and `question`: the sidekick is blocked until the user handles it. */
  kind: "working" | "approval" | "question" | "finished" | "stopped";
  childThreadId: ThreadId;
  title: string;
  /** Why a stopped sidekick stopped, when the provider said. */
  reason: string | null;
}>;

const STOPPED_STATUSES = new Set(["failed", "cancelled", "interrupted"]);

/**
 * What the composer says about a Fusion lead's sidekick, or null to stay out
 * of the way. It shows while the sidekick works and, once it settles, for the
 * rest of the lead turn it settled in, when the lead is reviewing its work.
 * A sidekick blocked on an approval or a question says so, since nothing
 * moves until the user handles it.
 */
export function resolveFusionSidekickActivity(input: {
  sidekick: Pick<OrchestrationV2Subagent, "childThreadId" | "status"> | null;
  child: Pick<
    EnvironmentThreadShell,
    "title" | "runtime" | "hasPendingApprovals" | "hasPendingUserInput"
  > | null;
  leadWorking: boolean;
  /** When the lead's current activity began; null while it is idle. */
  leadActivityStartedAt: string | null;
}): FusionSidekickActivity | null {
  const { sidekick, child } = input;
  if (sidekick?.childThreadId == null || child === null) return null;
  const base = { childThreadId: sidekick.childThreadId, title: child.title, reason: null };
  if (child.hasPendingApprovals || child.hasPendingUserInput) {
    // A request left behind by a finished run no longer holds anything up.
    if (!threadRuntimeIsActive(child.runtime)) return null;
    return { ...base, kind: child.hasPendingApprovals ? "approval" : "question" };
  }
  if (threadRuntimeIsActive(child.runtime)) return { ...base, kind: "working" };

  const { runtime } = child;
  if (!input.leadWorking || runtime === null || input.leadActivityStartedAt === null) return null;
  // Settled before this lead turn began: old news the lead already reported.
  if (Date.parse(runtime.updatedAt) < Date.parse(input.leadActivityStartedAt)) return null;

  return STOPPED_STATUSES.has(sidekick.status) || STOPPED_STATUSES.has(runtime.status)
    ? { ...base, kind: "stopped", reason: runtime.lastError }
    : { ...base, kind: "finished" };
}

/**
 * What a blocked sidekick is waiting on, from its newest request of that kind:
 * the command or prompt it wants approved, or the question it asked.
 */
export function describeSidekickBlocker(
  items: ReadonlyArray<Pick<OrchestrationV2ProjectedTurnItem, "visibility" | "item">>,
  blocker: "approval" | "question",
): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const { item, visibility } = items[index]!;
    if (visibility !== "local") continue;
    if (blocker === "approval" && item.type === "approval_request") {
      const need = runtimeRequestNeed(item.requestKind);
      const detail = item.prompt?.trim().split("\n", 1)[0]?.trim() || item.appName;
      return detail ? `Needs ${need}: ${detail}` : `Needs ${need}`;
    }
    if (blocker === "question" && item.type === "user_input_request" && !item.questionAnswer) {
      return item.questions[0]?.question ?? null;
    }
  }
  return null;
}

/** A sidekick command running this long is flagged as possibly stuck. */
export const SIDEKICK_STALL_MINUTES = 3;

/**
 * Whole minutes the sidekick's newest step has been running, when that step
 * is a command still running; null otherwise.
 */
export function runningSidekickCommandMinutes(
  items: ReadonlyArray<Pick<OrchestrationV2ProjectedTurnItem, "visibility" | "item">>,
  nowMs: number,
): number | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const { item, visibility } = items[index]!;
    if (visibility !== "local") continue;
    if (item.type !== "command_execution" || item.status !== "running" || !item.startedAt) {
      return null;
    }
    return Math.max(0, Math.floor((nowMs - DateTime.toEpochMillis(item.startedAt)) / 60_000));
  }
  return null;
}

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
