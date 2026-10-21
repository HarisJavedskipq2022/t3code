import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  fusionSidekickNeedsItems,
  presentFusionSidekick,
  resolveFusionSidekickActivity,
} from "@t3tools/client-runtime/state/fusion-sidekick";
import { resolveThreadWorkingStartedAt } from "@t3tools/client-runtime/state/models";
import type { OrchestrationV2Subagent, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { fusionSidekickRoleName } from "@t3tools/shared/fusion";
import { Atom } from "effect/reactivity";
import { CombineIcon } from "lucide-react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { useThreadShell, useThreadVisibleTurnItems } from "~/state/entities";
import { environmentThreadDetails } from "~/state/threads";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { WorkingTimer } from "./MessagesTimeline";

const NO_SIDEKICK_ATOM = Atom.make<OrchestrationV2Subagent | null>(null).pipe(
  Atom.withLabel("fusion-sidekick:none"),
);

/**
 * The composer banner for a Fusion lead's sidekick, or null while there is nothing to say.
 * `blockedThreadId` is the sidekick while this banner shows its approval or question, so the
 * generic subagent banner can leave it out.
 */
export function useFusionSidekickBanner(input: {
  /** Null until the thread exists on the server; see resolveThreadDetailRef. */
  threadRef: ScopedThreadRef | null;
  leadWorking: boolean;
  leadActivityStartedAt: string | null;
  onOpenThread: (threadId: ThreadId) => void;
  /** Interrupts the sidekick's current turn; its lead hears about it and decides what's next. */
  onStopThread: (threadId: ThreadId) => void;
}): {
  item: ComposerBannerStackItem | null;
  blockedThreadId: ThreadId | null;
  /** The sidekick while its banner shows. */
  sidekickThreadId: ThreadId | null;
} {
  const { threadRef, leadWorking, leadActivityStartedAt, onOpenThread, onStopThread } = input;
  const sidekick = useAtomValue(
    threadRef === null ? NO_SIDEKICK_ATOM : environmentThreadDetails.fusionSidekickAtom(threadRef),
  );
  const childThreadId = sidekick?.childThreadId ?? null;
  const childRef =
    threadRef === null || childThreadId === null
      ? null
      : scopeThreadRef(threadRef.environmentId, childThreadId);
  const child = useThreadShell(childRef);
  const leadFusion = useThreadShell(threadRef)?.fusion ?? null;
  const activity = resolveFusionSidekickActivity({
    sidekick,
    child,
    leadWorking,
    leadActivityStartedAt,
    role: leadFusion && sidekick ? fusionSidekickRoleName(leadFusion, sidekick) : null,
  });

  const kind = activity?.kind ?? null;
  const blocked = kind === "approval" || kind === "question";
  // Only a working or blocked sidekick's thread is read, and only while the lead's thread is open.
  const items = useThreadVisibleTurnItems(fusionSidekickNeedsItems(activity) ? childRef : null);
  // A minute clock is enough to spot a hang without repainting every second.
  const nowMs = Date.parse(`${useNowMinute()}Z`);
  const sidekickStartedAt =
    kind === "working" && child ? resolveThreadWorkingStartedAt(child) : null;
  const item = ((): ComposerBannerStackItem | null => {
    if (activity === null || childThreadId === null) return null;
    const view = presentFusionSidekick({ activity, items, nowMs });
    return {
      id: `fusion-sidekick:${childThreadId}`,
      variant: view.warning ? "warning" : "info",
      priority: "activity",
      icon: <CombineIcon />,
      title: view.title,
      description: view.description,
      // The sidekick thread, one click away, has the full story.
      descriptionDetails: false,
      actions: (
        <>
          {sidekickStartedAt ? (
            <span className="pe-1 text-muted-foreground">
              <WorkingTimer createdAt={sidekickStartedAt} />
            </span>
          ) : null}
          {view.stalled ? (
            <Button size="xs" variant="ghost" onClick={() => onStopThread(childThreadId)}>
              Stop sidekick
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={() => onOpenThread(childThreadId)}>
            {view.openLabel}
          </Button>
        </>
      ),
    };
  })();
  return {
    item,
    blockedThreadId: blocked ? childThreadId : null,
    sidekickThreadId: item === null ? null : childThreadId,
  };
}
