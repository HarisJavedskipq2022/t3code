import {
  commandOutputFilters,
  displayCommandSteps,
  formatTestSummary,
  parseGrepHits,
  parseTestSummary,
  splitCommandSteps,
  type CommandStep,
  type GrepHit,
} from "@t3tools/client-runtime/work-log/fork-command-steps";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import * as DateTime from "effect/DateTime";
import { CheckIcon, ChevronRightIcon, CopyIcon, FilterIcon } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { ShellCommandBlock } from "./ShellCommandBlock";

// A step longer than this, usually an inline script, shows its first 8 lines.
const LONG_STEP_LINES = 12;
// One setup step reads fine inline; folding pays off from two.
const FOLD_SETUP_FROM = 2;

const toggleClassName =
  "inline-flex items-center gap-0.5 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function StepLine(props: { readonly step: CommandStep }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = props.step.text.split("\n").length;
  const long = lineCount > LONG_STEP_LINES;
  // `&&` and `;` read as "then"; `||` and `&` change what the step means, so they stay visible.
  const joiner = props.step.joiner === "||" || props.step.joiner === "&" ? props.step.joiner : null;
  return (
    <div className="flex min-w-0 gap-1.5">
      {joiner ? <span className="shrink-0 text-muted-foreground/70">{joiner}</span> : null}
      <div className="min-w-0 flex-1">
        <div className={cn(long && !expanded && "max-h-[8lh] overflow-hidden")}>
          <ShellCommandBlock command={props.step.text} />
        </div>
        {long ? (
          <button type="button" className={toggleClassName} onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : `Show all ${lineCount} lines`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * An expanded command as its steps: a leading `cd` becomes the folder it runs
 * in, setup that leads up to the work folds into one line, `||` and `&` stay
 * visible, and long inline scripts clip. The duration, a non-zero exit code
 * and copy for the whole command sit in the header, or in the corner without one.
 */
export function ForkCommandSteps(props: {
  readonly command: string;
  readonly exitCode: number | undefined;
  readonly durationMs: number | null;
  readonly workspaceRoot?: string | undefined;
}) {
  const [showSetup, setShowSetup] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "command" });
  const { location, steps, setupCount } = displayCommandSteps(props.command, props.workspaceRoot);
  const foldable = setupCount >= FOLD_SETUP_FROM;
  const shown = foldable && !showSetup ? steps.slice(setupCount) : steps;
  const hasHeader = location !== "" || foldable;
  const CopyStateIcon = isCopied ? CheckIcon : CopyIcon;
  const meta = (
    <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
      {props.durationMs !== null ? <span>{formatDuration(props.durationMs)}</span> : null}
      {props.exitCode !== undefined && props.exitCode !== 0 ? (
        <span className="text-destructive">exit {props.exitCode}</span>
      ) : null}
      <button
        type="button"
        className={toggleClassName}
        aria-label={isCopied ? "Command copied" : "Copy command"}
        onClick={() => copyToClipboard(props.command.trim(), undefined)}
      >
        <CopyStateIcon aria-hidden className="size-3" />
      </button>
    </div>
  );
  return (
    <div className="relative rounded-md border border-border/45 bg-muted/15 p-2">
      {hasHeader ? (
        <div className="mb-1 flex min-w-0 items-center gap-2 text-muted-foreground">
          {location !== "" ? <span className="min-w-0 truncate">in {location}</span> : null}
          {foldable ? (
            <button
              type="button"
              className={cn(toggleClassName, "shrink-0")}
              aria-expanded={showSetup}
              onClick={() => setShowSetup(!showSetup)}
            >
              <ChevronRightIcon
                aria-hidden
                className={cn("size-3 transition-transform", showSetup && "rotate-90")}
              />
              {setupCount === 1 ? "1 setup step" : `${setupCount} setup steps`}
            </button>
          ) : null}
          <span className="flex-1" />
          {meta}
        </div>
      ) : (
        <div className="absolute top-2 right-2">{meta}</div>
      )}
      {/* Without a header the meta sits in the corner, so the steps leave it room. */}
      <div className={cn("space-y-0.5", !hasHeader && "pe-16")}>
        {shown.map((step, index) => (
          // Steps come from a fixed string and never reorder.
          // oxlint-disable-next-line react/no-array-index-key
          <StepLine key={index} step={step} />
        ))}
      </div>
    </div>
  );
}

/** `grep -n` output as a column of locations beside the dedented lines they point at. */
export function ForkGrepHits(props: { readonly hits: ReadonlyArray<GrepHit> }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      {props.hits.map((hit, index) => (
        // Hits come from fixed output and never reorder.
        // oxlint-disable-next-line react/no-array-index-key
        <Fragment key={index}>
          <span className="text-right text-muted-foreground/60 tabular-nums">{hit.location}</span>
          <span className="text-foreground/85">{hit.text}</span>
        </Fragment>
      ))}
    </div>
  );
}

/** The output formatted for reading when it is grep hits, else null to show it as is. */
export function forkFormattedCommandOutput(text: string): ReactNode {
  const hits = parseGrepHits(text);
  return hits === null ? null : <ForkGrepHits hits={hits} />;
}

/**
 * What a command's output adds up to, above the output: a test runner's pass
 * and fail counts, and a note when the output was cut by a pipe. A run piped
 * through `head` exits 0 even when tests failed, so the counts are the status.
 */
export function ForkCommandOutputSummary(props: {
  readonly command: string;
  readonly output: string | null;
}) {
  const summary = props.output ? parseTestSummary(props.output) : null;
  const filters = commandOutputFilters(splitCommandSteps(props.command));
  if (summary === null && filters.length === 0) return null;
  return (
    <div className="space-y-1">
      {summary !== null ? (
        <div
          className={cn(
            "rounded-md px-2 py-1",
            summary.failed > 0
              ? "bg-destructive/10 text-destructive"
              : "bg-success/10 text-success-foreground",
          )}
        >
          {formatTestSummary(summary)}
        </div>
      ) : null}
      {filters.length > 0 ? (
        <div className="flex items-center gap-1 text-muted-foreground/80">
          <FilterIcon aria-hidden className="size-3" />
          Output piped through {filters.join(", ")}
        </div>
      ) : null}
    </div>
  );
}

/** How long a finished command ran; null while it runs or when the provider gave no times. */
export function commandDurationMs(
  item: Pick<OrchestrationV2TurnItem, "startedAt" | "completedAt">,
): number | null {
  if (!item.startedAt || !item.completedAt) return null;
  return DateTime.toEpochMillis(item.completedAt) - DateTime.toEpochMillis(item.startedAt);
}
