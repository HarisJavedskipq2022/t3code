import { CircleDashedIcon } from "lucide-react";

import { Spinner } from "~/components/ui/spinner";

import { threadSyncLabel, type ThreadSyncPhase } from "../../threadSync";
import { ComposerBanner } from "./ComposerBanner";
import { WorkingTimer } from "./TimelineWorkGroupRows";

export function ComposerActivityRow({ phase }: { readonly phase: ThreadSyncPhase }) {
  return (
    <ComposerBanner.Row>
      <ComposerBanner.Icon>
        <Spinner />
      </ComposerBanner.Icon>
      <ComposerBanner.Content>
        <span
          className="shrink-0 whitespace-nowrap text-muted-foreground"
          data-composer-sync-status={phase}
          role="status"
        >
          {threadSyncLabel(phase)}
        </span>
      </ComposerBanner.Content>
    </ComposerBanner.Row>
  );
}

/**
 * What the agent is doing right now, attached above the composer for the whole
 * turn so it stays in view when the timeline's working row scrolls away.
 */
export function ComposerWorkingRow({
  step,
  startedAt,
}: {
  readonly step: string;
  readonly startedAt: string | null;
}) {
  return (
    <ComposerBanner.Row data-composer-working-status="true">
      <ComposerBanner.Icon className="text-primary">
        <CircleDashedIcon className="fork-working-spin" />
      </ComposerBanner.Icon>
      <ComposerBanner.Content>
        <span className="min-w-0 truncate text-foreground">{step}</span>
        {startedAt ? (
          <span className="ms-auto shrink-0 pe-2 text-muted-foreground">
            <WorkingTimer createdAt={startedAt} />
          </span>
        ) : null}
      </ComposerBanner.Content>
    </ComposerBanner.Row>
  );
}
