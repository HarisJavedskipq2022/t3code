import type {
  ModelSelection,
  OrchestrationV2AppThread,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadFusion,
  ThreadId,
} from "@t3tools/contracts";
import { findFusionSidekickFor } from "@t3tools/shared/fusion";
import { modelSelectionsEqual } from "@t3tools/shared/model";

/** Whether a Fusion pairing change needs a `thread.fusion-updated` event. */
export function threadFusionChanged(
  current: OrchestrationV2ThreadFusion | null,
  next: OrchestrationV2ThreadFusion | null,
): boolean {
  if (current === null || next === null) return current !== next;
  const currentRoles = current.roles ?? [];
  const nextRoles = next.roles ?? [];
  return (
    !modelSelectionsEqual(current.sidekick, next.sidekick) ||
    currentRoles.length !== nextRoles.length ||
    currentRoles.some((role, index) => {
      const other = nextRoles[index]!;
      return (
        role.name !== other.name ||
        role.useFor !== other.useFor ||
        !modelSelectionsEqual(role.sidekick, other.sidekick)
      );
    })
  );
}

// A failed or cancelled sidekick is replaced rather than continued.
const REUSABLE_SIDEKICK_STATUSES = new Set<OrchestrationV2Subagent["status"]>([
  "idle",
  "pending",
  "running",
  "waiting",
  "completed",
]);

function sidekickTarget(sidekick: ModelSelection): string {
  return JSON.stringify({
    providerInstanceId: sidekick.instanceId,
    model: sidekick.model,
    ...(sidekick.options === undefined ? {} : { options: sidekick.options }),
  });
}

/**
 * Instructions prepended to each lead turn while Fusion is on. They carry each
 * sidekick's target and, once it exists, the sidekick thread to keep using.
 */
function fusionLeadInstructions(input: {
  readonly fusion: OrchestrationV2ThreadFusion;
  readonly subagents: ReadonlyArray<OrchestrationV2Subagent>;
}): string {
  const { fusion, subagents } = input;
  const threadOf = (sidekick: ModelSelection) =>
    findFusionSidekickFor(subagents, sidekick, REUSABLE_SIDEKICK_STATUSES)?.childThreadId ?? null;
  const roles = fusion.roles ?? [];
  const sidekickBlock =
    roles.length === 0
      ? defaultSidekickLines(fusion.sidekick, threadOf(fusion.sidekick))
      : roleSidekickLines(fusion, threadOf);
  return [
    "<t3_fusion>",
    roles.length === 0
      ? "Fusion is on for this thread. You are the LEAD: you understand the task, make the decisions, plan, and review. One persistent SIDEKICK agent writes the code."
      : "Fusion is on for this thread. You are the LEAD: you understand the task, make the decisions, plan, and review. Persistent SIDEKICK agents write the code: one per role the user named, plus a default one.",
    ...sidekickBlock,
    "",
    "Protocol:",
    "1. Plan: read the relevant code and repo instructions (AGENTS.md, CLAUDE.md). Split the work into concrete steps the sidekick can finish without design decisions, one goal per step. Keep the hard parts yourself (risky infrastructure, concurrency, process lifecycle, tricky test scaffolding) or settle them in the brief; give the sidekick the well-specified bulk: features, wiring, UI, ordinary tests. In plan mode, stop after the plan.",
    "2. Brief the sidekick with the goal, the full plan with the current step marked, the repo rules that matter (instruction files, test and lint commands), and these working rules: implement only the current step; when the plan looks wrong or ambiguous, stop and say why; don't commit, push, or open pull requests; run tests with a short per-test timeout, never pipe test output through tail or head, and when a run takes several times its usual time, stop it and report instead of retrying. Ask it to report the files changed, the commands run with their results, and open questions. Keep briefs short. Don't widen a step while it runs; save new findings for the next round unless they block the current one.",
    "3. Wait with t3_thread_wait on the sidekick thread (wait again on timedOut) and read each result with task_status.",
    "4. Verify every report yourself: git diff, the files, and the checks the step named. Then send the next step or a concrete correction. Don't edit files while the sidekick works; you share one checkout. Make only small fixes, while it is idle, and tell it about them.",
    "5. Stop and ask the user when a defect survives two corrections, when a decision is needed that the user hasn't made, or after 8 rounds.",
    "6. Finish with the repo's final verification and a short report: lead and sidekick models, number of rounds, what changed and how it was verified.",
    "Answer questions and small requests that need no code changes yourself, without the sidekick.",
    "</t3_fusion>",
  ].join("\n");
}

function defaultSidekickLines(sidekick: ModelSelection, threadId: ThreadId | null): string[] {
  return [
    `Sidekick target: ${sidekickTarget(sidekick)}`,
    threadId === null
      ? 'No sidekick exists yet. When the task needs code changes, start it once with delegate_task: the target above, role "implementation", mode "async", and a title starting "Fusion sidekick: ".'
      : `Your sidekick is thread ${threadId}. Continue it with t3_thread_send (mode "queue", a new clientRequestId each round); it keeps its context. Do not start another sidekick.`,
    "In Fusion you keep working with this one sidekick through t3_thread_send. This overrides the general advice to call delegate_task again for each round.",
  ];
}

function roleSidekickLines(
  fusion: OrchestrationV2ThreadFusion,
  threadOf: (sidekick: ModelSelection) => ThreadId | null,
): string[] {
  const line = (label: string, sidekick: ModelSelection, titleTag: string) => {
    const threadId = threadOf(sidekick);
    return threadId === null
      ? `- ${label}: not started. Target: ${sidekickTarget(sidekick)}. Start it with delegate_task the first time it gets a step: this target, role "implementation", mode "async", and a title starting "Fusion sidekick${titleTag}: ".`
      : `- ${label}: thread ${threadId}. Continue it with t3_thread_send (mode "queue", a new clientRequestId each round); it keeps its context.`;
  };
  return [
    "Sidekicks:",
    ...(fusion.roles ?? []).map((role) =>
      line(
        role.useFor === "" ? `"${role.name}"` : `"${role.name}", for ${role.useFor}`,
        role.sidekick,
        ` (${role.name})`,
      ),
    ),
    line("default, for every step no role above fits", fusion.sidekick, ""),
    "Send each step to the one sidekick whose role fits it best. Only one sidekick works at a time: you all share one checkout, so wait for its report before giving any sidekick the next step. Don't start another sidekick for one that has a thread; keep working with it through t3_thread_send. This overrides the general advice to call delegate_task again for each round.",
  ];
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
  return fusionLeadInstructions({ fusion, subagents: input.subagents });
}
