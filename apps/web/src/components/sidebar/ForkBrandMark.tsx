import { cn } from "../../lib/utils";

const FORK_APP_NAME = "HCode";

export function ForkBrandMark({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight">
      <span
        aria-hidden
        className="grid size-[18px] shrink-0 place-items-center rounded-md bg-(--fork-brand) text-2xs leading-none font-extrabold text-(--fork-brand-ink)"
      >
        H
      </span>
      <span className={cn("truncate", onBackdrop ? "text-white" : "text-foreground")}>
        {FORK_APP_NAME}
      </span>
    </span>
  );
}
