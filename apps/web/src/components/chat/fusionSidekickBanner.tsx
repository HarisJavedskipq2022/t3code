import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveThreadWorkingStartedAt } from "@t3tools/client-runtime/state/models";
import type { OrchestrationV2Subagent, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { CombineIcon } from "lucide-react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { useThreadShell, useThreadVisibleTurnItems } from "~/state/entities";
import { environmentThreadDetails } from "~/state/threads";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { describeAgentStep } from "./agentStep.logic";
import { WorkingTimer } from "./MessagesTimeline";
import {
  describeSidekickBlocker,
  resolveFusionSidekickActivity,
  runningSidekickCommandMinutes,
  SIDEKICK_STALL_MINUTES,
} from "./fusionSidekickBanner.logic";

const NO_SIDEKICK_ATOM = Atom.make<OrchestrationV2Subagent | null>(null).pipe(
  Atom.withLabel("fusion-sidekick:none"),
);

const TITLES = {
  working: "Sidekick is working",
  approval: "Sidekick needs approval",
  question: "Sidekick has a question",
  finished: "Sidekick finished · lead is reviewing",
  stopped: "Sidekick stopped",
  stalled: "Sidekick may be stuck",
} as const;

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
  const activity = resolveFusionSidekickActivity({
    sidekick,
    child,
    leadWorking,
    leadActivityStartedAt,
  });

  const kind = activity?.kind ?? null;
  const blocker = kind === "approval" || kind === "question" ? kind : null;
  // Only a working or blocked sidekick's thread is read, and only while the lead's thread is open.
  const items = useThreadVisibleTurnItems(kind === "working" || blocker !== null ? childRef : null);
  const step =
    blocker === null ? describeAgentStep(items) : describeSidekickBlocker(items, blocker);
  // A minute clock is enough to spot a hang without repainting every second.
  const nowMs = Date.parse(`${useNowMinute()}Z`);
  const commandMinutes = kind === "working" ? runningSidekickCommandMinutes(items, nowMs) : null;
  const stalled = commandMinutes !== null && commandMinutes >= SIDEKICK_STALL_MINUTES;
  const sidekickStartedAt =
    kind === "working" && child ? resolveThreadWorkingStartedAt(child) : null;
  const title = activity?.title ?? null;
  const reason = activity?.reason ?? null;
  const item = ((): ComposerBannerStackItem | null => {
    if (kind === null || childThreadId === null) return null;
    const elapsed = commandMinutes ? ` · ${commandMinutes}m` : "";
    return {
      id: `fusion-sidekick:${childThreadId}`,
      variant: kind === "stopped" || blocker !== null || stalled ? "warning" : "info",
      priority: "activity",
      icon: <CombineIcon />,
      title: TITLES[stalled ? "stalled" : kind],
      description: reason ?? (step ? `${step}${elapsed}` : title),
      // The sidekick thread, one click away, has the full story.
      descriptionDetails: false,
      actions: (
        <>
          {sidekickStartedAt ? (
            <span className="pe-1 text-muted-foreground">
              <WorkingTimer createdAt={sidekickStartedAt} />
            </span>
          ) : null}
          {stalled ? (
            <Button size="xs" variant="ghost" onClick={() => onStopThread(childThreadId)}>
              Stop sidekick
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={() => onOpenThread(childThreadId)}>
            {blocker === "approval"
              ? "Open approval"
              : blocker === "question"
                ? "Open question"
                : "Open sidekick"}
          </Button>
        </>
      ),
    };
  })();
  return {
    item,
    blockedThreadId: blocker === null ? null : childThreadId,
    sidekickThreadId: item === null ? null : childThreadId,
  };
}
