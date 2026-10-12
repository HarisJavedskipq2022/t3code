import type {
  OrchestrationV2AppThread,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadFusion,
  ThreadId,
} from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";

/** Whether a Fusion pairing change needs a `thread.fusion-updated` event. */
export function threadFusionChanged(
  current: OrchestrationV2ThreadFusion | null,
  next: OrchestrationV2ThreadFusion | null,
): boolean {
  if (current === null || next === null) return current !== next;
  return !modelSelectionsEqual(current.sidekick, next.sidekick);
}

const REUSABLE_SIDEKICK_STATUSES = new Set<OrchestrationV2Subagent["status"]>([
  "idle",
  "pending",
  "running",
  "waiting",
  "completed",
]);

/**
 * The lead's current sidekick: its latest app-owned child running the sidekick
 * model that has not failed or been cancelled. Matching on instance and model
 * leaves the lead free to tune options such as effort per delegation.
 */
export function findFusionSidekick(
  subagents: ReadonlyArray<OrchestrationV2Subagent>,
  fusion: OrchestrationV2ThreadFusion,
): ThreadId | null {
  const sidekick = subagents.findLast(
    (subagent) =>
      subagent.origin === "app_owned" &&
      subagent.childThreadId !== null &&
      subagent.modelSelection?.instanceId === fusion.sidekick.instanceId &&
      subagent.modelSelection.model === fusion.sidekick.model &&
      REUSABLE_SIDEKICK_STATUSES.has(subagent.status),
  );
  return sidekick?.childThreadId ?? null;
}

/**
 * Instructions prepended to each lead turn while Fusion is on. They carry the
 * sidekick target and, once one exists, the sidekick thread to keep using.
 */
function fusionLeadInstructions(input: {
  readonly fusion: OrchestrationV2ThreadFusion;
  readonly sidekickThreadId: ThreadId | null;
}): string {
  const { sidekick } = input.fusion;
  const target = JSON.stringify({
    providerInstanceId: sidekick.instanceId,
    model: sidekick.model,
    ...(sidekick.options === undefined ? {} : { options: sidekick.options }),
  });
  const sidekickLine =
    input.sidekickThreadId === null
      ? 'No sidekick exists yet. When the task needs code changes, start it once with delegate_task: the target above, role "implementation", mode "async", and a title starting "Fusion sidekick: ".'
      : `Your sidekick is thread ${input.sidekickThreadId}. Continue it with t3_thread_send (mode "queue", a new clientRequestId each round); it keeps its context. Do not start another sidekick.`;
  return [
    "<t3_fusion>",
    "Fusion is on for this thread. You are the LEAD: you understand the task, make the decisions, plan, and review. One persistent SIDEKICK agent writes the code.",
    `Sidekick target: ${target}`,
    sidekickLine,
    "In Fusion you keep working with this one sidekick through t3_thread_send. This overrides the general advice to call delegate_task again for each round.",
    "",
    "Protocol:",
    "1. Plan: read the relevant code and repo instructions (AGENTS.md, CLAUDE.md). Split the work into concrete steps the sidekick can finish without design decisions. In plan mode, stop after the plan.",
    "2. Brief the sidekick with the goal, the full plan with the current step marked, the repo rules that matter (instruction files, test and lint commands), and these working rules: implement only the current step; when the plan looks wrong or ambiguous, stop and say why; don't commit, push, or open pull requests. Ask it to report the files changed, the commands run with their results, and open questions.",
    "3. Wait with t3_thread_wait on the sidekick thread (wait again on timedOut) and read each result with task_status.",
    "4. Verify every report yourself: git diff, the files, and the checks the step named. Then send the next step or a concrete correction. Don't edit files while the sidekick works; you share one checkout. Make only small fixes, while it is idle, and tell it about them.",
    "5. Stop and ask the user when a defect survives two corrections, when a decision is needed that the user hasn't made, or after 8 rounds.",
    "6. Finish with the repo's final verification and a short report: lead and sidekick models, number of rounds, what changed and how it was verified.",
    "Answer questions and small requests that need no code changes yourself, without the sidekick.",
    "</t3_fusion>",
  ].join("\n");
}

/**
 * The Fusion block for a turn of this thread, or "" when the thread is not a
 * lead or the turn is a compaction rather than a prompt.
 */
export function fusionTurnInstructions(input: {
  readonly thread: Pick<OrchestrationV2AppThread, "fusion">;
  readonly subagents: ReadonlyArray<OrchestrationV2Subagent>;
  readonly compact: boolean;
}): string {
  const fusion = input.thread.fusion ?? null;
  if (fusion === null || input.compact) return "";
  return fusionLeadInstructions({
    fusion,
    sidekickThreadId: findFusionSidekick(input.subagents, fusion),
  });
}
