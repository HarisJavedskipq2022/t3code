import { cn } from "../../lib/utils";

/** Jira's own cue: a red square for bugs, a blue one for everything else. */
export function TicketTypeMark({
  isBug,
  className,
}: {
  readonly isBug: boolean;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-xs",
        isBug ? "bg-destructive" : "bg-info",
        className,
      )}
    />
  );
}
