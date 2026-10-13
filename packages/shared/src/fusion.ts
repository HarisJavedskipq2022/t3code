import type { OrchestrationV2Subagent, OrchestrationV2ThreadFusion } from "@t3tools/contracts";

/**
 * The latest app-owned child of a Fusion lead that runs the sidekick model,
 * optionally limited to `statuses`. Matching on instance and model leaves the
 * lead free to tune options such as effort per delegation.
 */
export function findFusionSidekick(
  subagents: ReadonlyArray<OrchestrationV2Subagent>,
  fusion: OrchestrationV2ThreadFusion,
  statuses?: ReadonlySet<OrchestrationV2Subagent["status"]>,
): OrchestrationV2Subagent | null {
  for (let index = subagents.length - 1; index >= 0; index -= 1) {
    const subagent = subagents[index]!;
    if (
      subagent.origin === "app_owned" &&
      subagent.childThreadId !== null &&
      subagent.modelSelection?.instanceId === fusion.sidekick.instanceId &&
      subagent.modelSelection.model === fusion.sidekick.model &&
      (statuses === undefined || statuses.has(subagent.status))
    ) {
      return subagent;
    }
  }
  return null;
}
