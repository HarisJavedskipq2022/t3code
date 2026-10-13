import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { OrchestrationV2Subagent, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { CombineIcon } from "lucide-react";
import { useMemo } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { useThreadShell, useThreadVisibleTurnItems } from "~/state/entities";
import { environmentThreadDetails } from "~/state/threads";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import {
  describeSidekickStep,
  resolveFusionSidekickActivity,
  runningSidekickCommandMinutes,
  SIDEKICK_STALL_MINUTES,
} from "./fusionSidekickBanner.logic";

const NO_SIDEKICK_ATOM = Atom.make<OrchestrationV2Subagent | null>(null).pipe(
  Atom.withLabel("fusion-sidekick:none"),
);

const TITLES = {
  working: "Sidekick is working",
  finished: "Sidekick finished · lead is reviewing",
  stopped: "Sidekick stopped",
  stalled: "Sidekick may be stuck",
} as const;

/** The composer banner for a Fusion lead's sidekick, or null while there is nothing to say. */
export function useFusionSidekickBanner(input: {
  /** Null until the thread exists on the server; see resolveThreadDetailRef. */
  threadRef: ScopedThreadRef | null;
  leadWorking: boolean;
  leadActivityStartedAt: string | null;
  onOpenThread: (threadId: ThreadId) => void;
  /** Interrupts the sidekick's current turn; its lead hears about it and decides what's next. */
  onStopThread: (threadId: ThreadId) => void;
}): ComposerBannerStackItem | null {
  const { threadRef, leadWorking, leadActivityStartedAt, onOpenThread, onStopThread } = input;
  const sidekick = useAtomValue(
    threadRef === null ? NO_SIDEKICK_ATOM : environmentThreadDetails.fusionSidekickAtom(threadRef),
  );
  const childThreadId = sidekick?.childThreadId ?? null;
  const childRef = useMemo(
    () =>
      threadRef === null || childThreadId === null
        ? null
        : scopeThreadRef(threadRef.environmentId, childThreadId),
    [threadRef, childThreadId],
  );
  const child = useThreadShell(childRef);
  const activity = resolveFusionSidekickActivity({
    sidekick,
    child,
    leadWorking,
    leadActivityStartedAt,
  });

  const kind = activity?.kind ?? null;
  // Only a working sidekick's thread is read, and only while the lead's thread is open.
  const items = useThreadVisibleTurnItems(kind === "working" ? childRef : null);
  const step = describeSidekickStep(items);
  // A minute clock is enough to spot a hang without repainting every second.
  const commandMinutes = runningSidekickCommandMinutes(items, Date.parse(`${useNowMinute()}Z`));
  const stalled = commandMinutes !== null && commandMinutes >= SIDEKICK_STALL_MINUTES;
  const title = activity?.title ?? null;
  const reason = activity?.reason ?? null;
  return useMemo(() => {
    if (kind === null || childThreadId === null) return null;
    const elapsed = commandMinutes ? ` · ${commandMinutes}m` : "";
    return {
      id: `fusion-sidekick:${childThreadId}`,
      variant: kind === "stopped" || stalled ? "warning" : "info",
      priority: "activity",
      icon: <CombineIcon />,
      title: TITLES[stalled ? "stalled" : kind],
      description: reason ?? (step ? `${step}${elapsed}` : title),
      actions: (
        <>
          {stalled ? (
            <Button size="xs" variant="ghost" onClick={() => onStopThread(childThreadId)}>
              Stop sidekick
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={() => onOpenThread(childThreadId)}>
            Open sidekick
          </Button>
        </>
      ),
    };
  }, [
    kind,
    childThreadId,
    step,
    title,
    reason,
    commandMinutes,
    stalled,
    onOpenThread,
    onStopThread,
  ]);
}
