import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  ProjectScript,
  RunId,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { resolveDiscoveredServerUrl } from "../../browser/browserTargetResolver";
import { openUrlInPreview } from "../../browser/openFileInPreview";
import { composerTargetKey, type DraftId } from "../../composerDraftStore";
import { useFusionDraftStore } from "../../fusionDraftStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { isPreviewSupportedInRuntime } from "../../previewStateStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { previewEnvironment } from "../../state/preview";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { worktreeServicesEnvironment } from "../../state/worktreeServices";
import { buildThreadRouteParams } from "../../threadRoutes";
import { describeAgentStep } from "./agentStep.logic";
import { useFusionSidekickBanner } from "./fusionSidekickBanner";

/**
 * HCode's additions to ChatView: app services, the Fusion sidekick banner, the composer's
 * working status and the Vet surface. Kept here so ChatView carries only call sites.
 */
export function useForkChatViewExtras(input: {
  environmentId: EnvironmentId;
  activeThreadRef: ScopedThreadRef | null;
  /** The guarded ref: subscribing to a draft before its thread exists caches "not found". */
  routeThreadDetailRef: ScopedThreadRef | null;
  vetAvailable: boolean;
  isWorking: boolean;
  isPreparingWorktree: boolean;
  isCompacting: boolean;
  paintOnlyDisplayedTimeline: boolean;
  activeWorkStartedAt: string | null;
  activeRunId: RunId | null;
  leadActivityStartedAt: string | null;
  turnItems: ReadonlyArray<OrchestrationV2ProjectedTurnItem> | null | undefined;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
}) {
  const { environmentId, activeThreadRef, setThreadError } = input;
  const navigate = useNavigate();
  const controlService = useAtomCommand(worktreeServicesEnvironment.control, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const interruptThreadTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });

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

  const openThread = (threadId: ThreadId) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };
  const openThreadStable = useStableCallback(openThread);
  const stopThread = (threadId: ThreadId) => {
    void interruptThreadTurn({ environmentId, input: { threadId } });
  };
  const stopThreadStable = useStableCallback(stopThread);
  const { item: fusionSidekickBannerItem, blockedThreadId } = useFusionSidekickBanner({
    threadRef: input.routeThreadDetailRef,
    leadWorking: input.isWorking,
    leadActivityStartedAt: input.leadActivityStartedAt,
    onOpenThread: openThreadStable,
    onStopThread: stopThreadStable,
  });
  // The Fusion banner already shows its blocked sidekick's request.
  const hideBlockedSidekick = <T extends { readonly id: ThreadId }>(
    children: ReadonlyArray<T>,
  ): ReadonlyArray<T> =>
    blockedThreadId === null ? children : children.filter((child) => child.id !== blockedThreadId);

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
    fusionSidekickBannerItem,
    hideBlockedSidekick,
    composerWorkingStatus,
    vetTabProps: { onAddVet: addVetSurfaceStable, vetAvailable: input.vetAvailable },
  };
}

/** Only an explicit Fusion choice is sent, and only to servers that lead with it. */
export function fusionTurnStartField(
  composerDraftTarget: ScopedThreadRef | DraftId,
  environmentId: EnvironmentId,
) {
  const fusion = useFusionDraftStore.getState().byTargetKey[composerTargetKey(composerDraftTarget)];
  const supportsFusion =
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .fusion === true;
  return supportsFusion && fusion !== undefined ? { fusion } : {};
}
