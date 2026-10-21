import {
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2Subagent,
  type RunId,
  runtimeRequestNeed,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveT3McpToolDefinition } from "@t3tools/shared/t3McpToolPresentation";
import * as DateTime from "effect/DateTime";

import { threadRuntimeIsActive, type EnvironmentThreadShell } from "./models.ts";

type TurnRow = Pick<OrchestrationV2ProjectedTurnItem, "visibility" | "item">;

const STEP_MAX_LENGTH = 80;

function firstLine(text: string): string {
  const line = text.trim().split("\n", 1)[0]!.trim();
  return line.length > STEP_MAX_LENGTH ? `${line.slice(0, STEP_MAX_LENGTH - 1)}…` : line;
}

/**
 * A few words on what a working agent is doing, from its newest item of its
 * own; items inherited from another thread (a sidekick's lead) are skipped.
 * With a run id, it stops at the first item of an earlier run: right after a
 * send the newest items are still the previous run's.
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

export type FusionSidekickActivity = Readonly<{
  /** `approval` and `question`: the sidekick is blocked until the user handles it. */
  kind: "working" | "approval" | "question" | "finished" | "stopped";
  childThreadId: ThreadId;
  title: string;
  /** Why a stopped sidekick stopped, when the provider said. */
  reason: string | null;
  /** The role the user named this sidekick for; null for the default sidekick. */
  role: string | null;
}>;

const STOPPED_STATUSES = new Set(["failed", "cancelled", "interrupted"]);

/**
 * What a Fusion lead says about its sidekick, or null to stay out of the way.
 * It shows while the sidekick works and, once it settles, for the rest of the
 * lead turn it settled in, when the lead is reviewing its work. A sidekick
 * blocked on an approval or a question says so, since nothing moves until the
 * user handles it.
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
  role?: string | null;
}): FusionSidekickActivity | null {
  const { sidekick, child } = input;
  if (sidekick?.childThreadId == null || child === null) return null;
  const base = {
    childThreadId: sidekick.childThreadId,
    title: child.title,
    reason: null,
    role: input.role ?? null,
  };
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
  items: ReadonlyArray<TurnRow>,
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
  items: ReadonlyArray<TurnRow>,
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

/** Only a working or blocked sidekick's thread needs to be read for its step. */
export function fusionSidekickNeedsItems(activity: FusionSidekickActivity | null): boolean {
  return activity !== null && activity.kind !== "finished" && activity.kind !== "stopped";
}

const TITLES = {
  working: "Sidekick is working",
  approval: "Sidekick needs approval",
  question: "Sidekick has a question",
  finished: "Sidekick finished · lead is reviewing",
  stopped: "Sidekick stopped",
  stalled: "Sidekick may be stuck",
} as const;

export type FusionSidekickPresentation = Readonly<{
  title: string;
  /** Stopped, blocked or possibly stuck: something needs a look. */
  warning: boolean;
  description: string;
  stalled: boolean;
  openLabel: string;
}>;

/** The words every client shows for a Fusion lead's sidekick. */
export function presentFusionSidekick(input: {
  activity: FusionSidekickActivity;
  /** The sidekick's visible turn items; empty when it is not read. */
  items: ReadonlyArray<TurnRow>;
  nowMs: number;
}): FusionSidekickPresentation {
  const { activity, items } = input;
  const { kind } = activity;
  const blocker = kind === "approval" || kind === "question" ? kind : null;
  const step =
    blocker === null ? describeAgentStep(items) : describeSidekickBlocker(items, blocker);
  const commandMinutes =
    kind === "working" ? runningSidekickCommandMinutes(items, input.nowMs) : null;
  const stalled = commandMinutes !== null && commandMinutes >= SIDEKICK_STALL_MINUTES;
  const elapsed = commandMinutes ? ` · ${commandMinutes}m` : "";
  const title = TITLES[stalled ? "stalled" : kind];
  return {
    title: activity.role === null ? title : `${activity.role} ${title.toLowerCase()}`,
    warning: kind === "stopped" || blocker !== null || stalled,
    description: activity.reason ?? (step ? `${step}${elapsed}` : activity.title),
    stalled,
    openLabel:
      blocker === "approval"
        ? "Open approval"
        : blocker === "question"
          ? "Open question"
          : "Open sidekick",
  };
}
