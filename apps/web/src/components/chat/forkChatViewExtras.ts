import { describeAgentStep } from "@t3tools/client-runtime/state/agent-step";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  ProjectScript,
  RunId,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

import { resolveDiscoveredServerUrl } from "../../browser/browserTargetResolver";
import { openUrlInPreview } from "../../browser/openFileInPreview";
import { useStableCallback } from "../../hooks/useStableCallback";
import { isPreviewSupportedInRuntime } from "../../previewStateStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import { worktreeServicesEnvironment } from "../../state/worktreeServices";

/**
 * HCode's additions to ChatView: app services, the composer's working status and the
 * Vet surface. Kept here so ChatView carries only call sites.
 */
export function useForkChatViewExtras(input: {
  environmentId: EnvironmentId;
  activeThreadRef: ScopedThreadRef | null;
  vetAvailable: boolean;
  isWorking: boolean;
  isPreparingWorktree: boolean;
  isCompacting: boolean;
  paintOnlyDisplayedTimeline: boolean;
  activeWorkStartedAt: string | null;
  activeRunId: RunId | null;
  turnItems: ReadonlyArray<OrchestrationV2ProjectedTurnItem> | null | undefined;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
}) {
  const { environmentId, activeThreadRef, setThreadError } = input;
  const controlService = useAtomCommand(worktreeServicesEnvironment.control, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });

  const startAppService = async (script: ProjectScript, threadId: ThreadId) => {
    const result = await controlService({
      environmentId,
      input: { threadId, scriptId: script.id, action: "start" },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result))
        setThreadError(threadId, "Could not start app service.");
      return;
    }
    const row = result.value.services.find((row) => row.scriptId === script.id);
    if (row?.error) setThreadError(threadId, row.error);
    if (
      row?.status === "running" &&
      script.autoOpenPreview &&
      script.previewUrl &&
      isPreviewSupportedInRuntime()
    ) {
      await openUrlInPreview({
        threadRef: { environmentId, threadId },
        url: resolveDiscoveredServerUrl(environmentId, script.previewUrl),
        openPreview,
      });
    }
  };

  const activeRunStep =
    input.activeRunId === null ? null : describeAgentStep(input.turnItems ?? [], input.activeRunId);
  const workingStep = input.isPreparingWorktree
    ? "Setting up worktree"
    : input.isCompacting
      ? "Compacting conversation"
      : (activeRunStep ?? "Working");
  const composerWorkingStatus =
    input.isWorking && !input.paintOnlyDisplayedTimeline
      ? { step: workingStep, startedAt: input.activeWorkStartedAt }
      : null;

  const addVetSurface = () => {
    if (!activeThreadRef || !input.vetAvailable) return;
    useRightPanelStore.getState().open(activeThreadRef, "vet");
  };
  const addVetSurfaceStable = useStableCallback(addVetSurface);

  return {
    startAppService,
    composerWorkingStatus,
    vetTabProps: { onAddVet: addVetSurfaceStable, vetAvailable: input.vetAvailable },
  };
}
