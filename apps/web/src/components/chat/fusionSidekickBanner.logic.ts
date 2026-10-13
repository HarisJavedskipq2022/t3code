import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { OrchestrationV2Subagent, ThreadId } from "@t3tools/contracts";

export type FusionSidekickActivity = Readonly<{
  kind: "working" | "finished" | "stopped";
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
 * Input requests are left to the child-input banner, which can answer them.
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
  if (child.hasPendingApprovals || child.hasPendingUserInput) return null;
  const base = { childThreadId: sidekick.childThreadId, title: child.title, reason: null };
  if (threadRuntimeIsActive(child.runtime)) return { ...base, kind: "working" };

  const { runtime } = child;
  if (!input.leadWorking || runtime === null || input.leadActivityStartedAt === null) return null;
  // Settled before this lead turn began: old news the lead already reported.
  if (Date.parse(runtime.updatedAt) < Date.parse(input.leadActivityStartedAt)) return null;

  return STOPPED_STATUSES.has(sidekick.status) || STOPPED_STATUSES.has(runtime.status)
    ? { ...base, kind: "stopped", reason: runtime.lastError }
    : { ...base, kind: "finished" };
}
