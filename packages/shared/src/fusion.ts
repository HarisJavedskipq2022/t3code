import type {
  ModelSelection,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadFusion,
} from "@t3tools/contracts";

type SubagentStatuses = ReadonlySet<OrchestrationV2Subagent["status"]>;

function runsSidekick(subagent: OrchestrationV2Subagent, sidekick: ModelSelection): boolean {
  return (
    subagent.origin === "app_owned" &&
    subagent.childThreadId !== null &&
    subagent.providerInstanceId === sidekick.instanceId &&
    // delegate_task records the model slug; only some paths add modelSelection.
    (subagent.modelSelection?.model ?? subagent.model) === sidekick.model
  );
}

function latestSubagent(
  subagents: ReadonlyArray<OrchestrationV2Subagent>,
  matches: (subagent: OrchestrationV2Subagent) => boolean,
  statuses: SubagentStatuses | undefined,
): OrchestrationV2Subagent | null {
  for (let index = subagents.length - 1; index >= 0; index -= 1) {
    const subagent = subagents[index]!;
    if (matches(subagent) && (statuses === undefined || statuses.has(subagent.status))) {
      return subagent;
    }
  }
  return null;
}

/**
 * The latest app-owned child running this sidekick model, optionally limited
 * to `statuses`. Matching on instance and model leaves the lead free to tune
 * options such as effort per delegation.
 */
export function findFusionSidekickFor(
  subagents: ReadonlyArray<OrchestrationV2Subagent>,
  sidekick: ModelSelection,
  statuses?: SubagentStatuses,
): OrchestrationV2Subagent | null {
  return latestSubagent(subagents, (subagent) => runsSidekick(subagent, sidekick), statuses);
}

/** The latest child of a Fusion lead running any of its sidekick models: the one most recently put to work. */
export function findFusionSidekick(
  subagents: ReadonlyArray<OrchestrationV2Subagent>,
  fusion: OrchestrationV2ThreadFusion,
  statuses?: SubagentStatuses,
): OrchestrationV2Subagent | null {
  const sidekicks = [fusion.sidekick, ...(fusion.roles ?? []).map((role) => role.sidekick)];
  return latestSubagent(
    subagents,
    (subagent) => sidekicks.some((sidekick) => runsSidekick(subagent, sidekick)),
    statuses,
  );
}

/** The role a Fusion sidekick child works for, or null for the default sidekick. */
export function fusionSidekickRoleName(
  fusion: OrchestrationV2ThreadFusion,
  subagent: OrchestrationV2Subagent,
): string | null {
  return fusion.roles?.find((role) => runsSidekick(subagent, role.sidekick))?.name ?? null;
}
