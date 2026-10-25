import { CircleDashedIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ComposerWorkingRow } from "./ComposerActivityStatus";

export interface ComposerForkProps {
  /** What the agent is doing while a turn runs; null when it is idle. */
  workingStatus?: {
    readonly step: string;
    readonly startedAt: string | null;
  } | null;
}

/**
 * The background-work banner's icon. While commands run it turns like the
 * Working row's, stepped so it never repaints every frame; while the work
 * waits on others it keeps upstream's pulsing dot.
 */
export function ForkBackgroundWorkIcon({ waiting }: { readonly waiting: boolean }) {
  return waiting ? (
    <span
      className="size-1.5 rounded-full bg-foreground motion-safe:animate-status-pulse"
      aria-hidden="true"
    />
  ) : (
    <CircleDashedIcon aria-hidden className="fork-working-spin text-primary" />
  );
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
  const row = status ? (
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
