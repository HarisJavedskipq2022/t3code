import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationV2FusionRole,
  OrchestrationV2ThreadFusion,
} from "@t3tools/contracts";
import type { ReactNode } from "react";

import { resolveComposerFusion, useFusionDraftStore } from "~/fusionDraftStore";
import type { ProviderInstanceEntry } from "~/providerInstances";
import { useServerConfigs } from "~/state/entities";
import { ComposerWorkingRow } from "./ComposerActivityStatus";
import { ComposerControlSeparator } from "./ComposerControl";
import { ComposerFusionControl } from "./ComposerFusionControl";

export interface ComposerForkProps {
  /** Called when Fusion turns on, so an unstarted thread can move to its own worktree. */
  onFusionEnabled?: () => void;
  /** What the agent is doing while a turn runs; null when it is idle. */
  workingStatus?: {
    readonly step: string;
    readonly startedAt: string | null;
    /** The lead is waiting on its sidekick, whose banner already shows the work. */
    readonly shownBySidekickBanner?: boolean;
  } | null;
}

/**
 * The remembered lineup, minus roles that now clash with the default sidekick:
 * the composer's model may stand in for a sidekick that was never chosen.
 */
function defaultFusion(
  sidekick: ModelSelection,
  roles: ReadonlyArray<OrchestrationV2FusionRole>,
): OrchestrationV2ThreadFusion {
  const kept = roles.filter(
    (role) =>
      role.sidekick.instanceId !== sidekick.instanceId || role.sidekick.model !== sidekick.model,
  );
  return kept.length === 0 ? { sidekick } : { sidekick, roles: kept };
}

/** The Fusion resting-controls block, only on servers that lead with Fusion. */
export function useComposerFusionBlocks(input: {
  environmentId: EnvironmentId;
  composerDraftTargetKey: string;
  threadFusion: OrchestrationV2ThreadFusion | null | undefined;
  selectedModelSelection: ModelSelection;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: Parameters<typeof ComposerFusionControl>[0]["modelOptionsByInstance"];
  planModeEnabled: boolean;
  collapsed: boolean;
  disabled: boolean;
  onFusionEnabled: (() => void) | undefined;
}): ReadonlyArray<{ id: string; content: ReactNode }> {
  const capabilities = useServerConfigs().get(input.environmentId)?.environment.capabilities;
  const fusionSupported = capabilities?.fusion === true;
  const draftFusion = useFusionDraftStore(
    (state) => state.byTargetKey[input.composerDraftTargetKey],
  );
  const lastFusionSidekick = useFusionDraftStore((state) => state.lastSidekick);
  const lastFusionRoles = useFusionDraftStore((state) => state.lastRoles);
  const setFusionDraft = useFusionDraftStore((state) => state.setFusion);
  if (!fusionSupported) return [];
  const composerFusion = resolveComposerFusion(draftFusion, input.threadFusion);
  const size = input.collapsed ? "xs" : "sm";
  return [
    {
      id: "fusion",
      content: (
        <>
          <ComposerControlSeparator size={size} />
          <ComposerFusionControl
            environmentId={input.environmentId}
            fusion={composerFusion}
            defaultFusion={defaultFusion(
              lastFusionSidekick ?? input.selectedModelSelection,
              lastFusionRoles,
            )}
            rolesSupported={capabilities?.fusionRoles === true}
            instanceEntries={input.instanceEntries}
            modelOptionsByInstance={input.modelOptionsByInstance}
            planModeEnabled={input.planModeEnabled}
            size={size}
            disabled={input.disabled}
            onFusionChange={(fusion) => {
              if (fusion !== null && composerFusion === null) input.onFusionEnabled?.();
              setFusionDraft(input.composerDraftTargetKey, fusion);
            }}
          />
        </>
      ),
    },
  ];
}

/**
 * The working row and the composer's working edge. `inline` is what the activity strip
 * shows when no banner stack holds the activity row: the tasks badge, else the working row.
 */
export function composerWorking(input: {
  workingStatus: ComposerForkProps["workingStatus"];
  hasBlockingTopDrawer: boolean;
  inlineTasksBadge: ReactNode;
  isDragOver: boolean;
}) {
  // An agent waiting on an approval or an answer is not working; the drawer says so.
  const status = input.hasBlockingTopDrawer ? null : (input.workingStatus ?? null);
  const row =
    status && !status.shownBySidekickBanner ? (
      <ComposerWorkingRow step={status.step} startedAt={status.startedAt} />
    ) : null;
  return {
    row,
    inline: input.inlineTasksBadge ?? row,
    // A static accent edge while the agent works; nothing animates.
    edgeClassName:
      status && !input.isDragOver
        ? "shadow-lg shadow-primary/25 ring-1 ring-inset ring-primary/45"
        : null,
  };
}
