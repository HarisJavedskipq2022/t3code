import {
  displayLimitWindows,
  type LimitPool,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";

export type UsageStripTone = "ok" | "low" | "out";

export interface UsageStripEntry {
  readonly pool: LimitPool;
  readonly windows: readonly LimitPoolWindow[];
  /** The window closest to running out, which the strip's bar shows. */
  readonly tightest: LimitPoolWindow;
  readonly resetAt: number | null;
}

export function usageStripTone(remainingPercent: number): UsageStripTone {
  if (remainingPercent <= 10) return "out";
  if (remainingPercent <= 35) return "low";
  return "ok";
}

/** One entry per provider, in pool order so rows hold still as numbers move. */
export function usageStripEntries(pools: readonly LimitPool[]): readonly UsageStripEntry[] {
  return pools.flatMap((pool) => {
    const windows = displayLimitWindows(pool);
    const tightest = windows.reduce<LimitPoolWindow | undefined>(
      (lowest, window) =>
        lowest === undefined || window.remainingPercent < lowest.remainingPercent ? window : lowest,
      undefined,
    );
    if (tightest === undefined) return [];
    // The countdown is to the reset that hands quota back, not one that restores nothing.
    const reset =
      tightest.resets.find((candidate) => candidate.restoresPercent > 0) ?? tightest.resets[0];
    return [
      {
        pool,
        windows,
        tightest,
        resetAt: reset?.at ?? null,
      },
    ];
  });
}

/** The collapsed strip shows only the provider closest to running out. */
export function tightestUsageStripEntry(
  entries: readonly UsageStripEntry[],
): UsageStripEntry | null {
  return entries.reduce<UsageStripEntry | null>(
    (lowest, entry) =>
      lowest === null || entry.tightest.remainingPercent < lowest.tightest.remainingPercent
        ? entry
        : lowest,
    null,
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A countdown narrow enough for the strip; the hover card carries the exact time. */
export function compactCountdown(resetAt: number, now: number): string {
  const remaining = resetAt - now;
  if (remaining <= 0) return "now";
  if (remaining >= DAY) return `${Math.floor(remaining / DAY)}d`;
  if (remaining >= HOUR) return `${Math.floor(remaining / HOUR)}h`;
  return `${Math.max(1, Math.floor(remaining / MINUTE))}m`;
}
