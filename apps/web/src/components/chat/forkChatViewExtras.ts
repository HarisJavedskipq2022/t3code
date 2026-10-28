import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectScript, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import { resolveDiscoveredServerUrl } from "../../browser/browserTargetResolver";
import { openUrlInPreview } from "../../browser/openFileInPreview";
import { useStableCallback } from "../../hooks/useStableCallback";
import { isPreviewSupportedInRuntime } from "../../previewStateStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import { worktreeServicesEnvironment } from "../../state/worktreeServices";

/**
 * HCode's additions to ChatView: app services and the Vet surface. Kept here so ChatView carries only call sites.
 */
export function useForkChatViewExtras(input: {
  environmentId: EnvironmentId;
  activeThreadRef: ScopedThreadRef | null;
  vetAvailable: boolean;
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

  const addVetSurface = () => {
    if (!activeThreadRef || !input.vetAvailable) return;
    useRightPanelStore.getState().open(activeThreadRef, "vet");
  };
  const addVetSurfaceStable = useStableCallback(addVetSurface);

  return {
    startAppService,
    vetTabProps: { onAddVet: addVetSurfaceStable, vetAvailable: input.vetAvailable },
  };
}
