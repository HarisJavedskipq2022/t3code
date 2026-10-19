import { useAtomValue } from "@effect/atom-react";
import {
  collectLimitAccounts,
  collectLimitPools,
  cursorUsageWindowDetails,
  formatResetsIn,
  type LimitPool,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { useSidebar } from "../ui/sidebar";
import { PaceIcon } from "../usage/UsageLimits";
import { readUsagePagePreferences, saveUsagePagePreferences } from "../usage/usagePagePreferences";
import {
  compactCountdown,
  tightestUsageStripEntry,
  type UsageStripEntry,
  type UsageStripTone,
  usageStripEntries,
  usageStripTone,
} from "./sidebarUsageStrip.logic";

const TONE_FILL: Record<UsageStripTone, string> = {
  ok: "bg-success",
  low: "bg-warning",
  out: "bg-destructive",
};

const COLLAPSED_KEY = "t3code:sidebar:usage-strip-collapsed";

// Countdowns only need minute precision; a faster clock would repaint the sidebar for nothing.
function useMinuteClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);
  return now;
}

function providerLabel(driver: LimitPool["driver"]) {
  return providerClients.get(driver)?.label ?? String(driver);
}

function windowLabel(pool: LimitPool, window: LimitPoolWindow) {
  return (
    (pool.driver === "cursor" ? cursorUsageWindowDetails(window.id)?.label : undefined) ??
    window.label
  );
}

function UsageBar({
  remainingPercent,
  className,
}: {
  readonly remainingPercent: number;
  readonly className?: string;
}) {
  return (
    <span className={cn("h-1 overflow-hidden rounded-full bg-foreground/10", className)}>
      <span
        className={cn("block h-full rounded-full", TONE_FILL[usageStripTone(remainingPercent)])}
        style={{ width: `${Math.max(2, remainingPercent)}%` }}
      />
    </span>
  );
}

function UsageHoverCard({ entry, now }: { readonly entry: UsageStripEntry; readonly now: number }) {
  const { pool } = entry;
  const label = providerLabel(pool.driver);
  const accountCount = pool.accounts.length;
  const plan = accountCount === 1 ? pool.accounts[0]?.plan : undefined;
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <ProviderInstanceIcon
          driverKind={pool.driver}
          displayName={label}
          indicatorBackground="var(--popover)"
          className="size-4"
          iconClassName="size-3.5 text-foreground/80"
        />
        <span className="shrink-0 text-sm font-medium text-foreground">{label}</span>
        <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
          {accountCount > 1 ? `${accountCount} accounts` : (plan ?? null)}
        </span>
      </div>
      {entry.windows.map((window) => {
        const reset = window.resets.find((candidate) => candidate.restoresPercent > 0);
        const resetsIn = reset ? formatResetsIn(reset.member.window, now) : null;
        return (
          <div key={`${window.kind}:${window.id}`} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {windowLabel(pool, window)}
              </span>
              {window.pace ? <PaceIcon pace={window.pace} /> : null}
              <span className="font-medium text-foreground tabular-nums">
                {window.remainingPercent}% left
              </span>
            </div>
            <UsageBar remainingPercent={window.remainingPercent} className="w-full" />
            {resetsIn ? (
              <span className="text-2xs text-muted-foreground first-letter:uppercase">
                {resetsIn}
              </span>
            ) : null}
          </div>
        );
      })}
      <p className="border-t pt-2 text-2xs text-muted-foreground">
        Click for every account on Usage → Limits.
      </p>
    </div>
  );
}

function UsageStripRow({
  entry,
  now,
  onOpen,
}: {
  readonly entry: UsageStripEntry;
  readonly now: number;
  readonly onOpen: () => void;
}) {
  const label = providerLabel(entry.pool.driver);
  const remaining = entry.tightest.remainingPercent;
  return (
    <PreviewCard>
      <PreviewCardTrigger
        delay={250}
        closeDelay={120}
        render={
          <button
            type="button"
            aria-label={`${label}: ${remaining}% left. Open usage limits`}
            onClick={onOpen}
            className="flex h-6 w-full items-center gap-2 rounded-md px-1.5 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        <ProviderInstanceIcon
          driverKind={entry.pool.driver}
          displayName={label}
          indicatorBackground="var(--sidebar)"
          className="size-4 shrink-0"
          iconClassName="size-3.5 text-foreground/80"
        />
        <UsageBar remainingPercent={remaining} className="min-w-0 flex-1" />
        <span className="w-8 shrink-0 text-right text-xs text-foreground tabular-nums">
          {remaining}%
        </span>
        <span className="w-6 shrink-0 text-right text-2xs text-muted-foreground tabular-nums">
          {entry.resetAt === null ? null : compactCountdown(entry.resetAt, now)}
        </span>
      </PreviewCardTrigger>
      <PreviewCardPopup side="right" align="end" sideOffset={10} className="w-64">
        <UsageHoverCard entry={entry} now={now} />
      </PreviewCardPopup>
    </PreviewCard>
  );
}

/**
 * Subscription limits at a glance. It reads the snapshots environments already
 * publish and never probes a provider itself, so it costs no extra requests.
 */
export function SidebarUsageStrip() {
  const enabled = useClientSettings((settings) => settings.sidebarUsageStripEnabled);
  const onUsagePage = useLocation({ select: (location) => location.pathname === "/usage" });
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const [collapsed, setCollapsed] = useLocalStorage(COLLAPSED_KEY, false, Schema.Boolean);
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const now = useMinuteClock();

  if (!enabled || onUsagePage) return null;
  const entries = usageStripEntries(collectLimitPools(collectLimitAccounts(presentations), now));
  const tightest = tightestUsageStripEntry(entries);
  if (tightest === null) return null;

  const openLimits = () => {
    if (isMobile) setOpenMobile(false);
    saveUsagePagePreferences({ ...readUsagePagePreferences(), metric: "limits" });
    void navigate({ to: "/usage" });
  };

  return (
    <section aria-label="Usage limits" className="flex flex-col gap-0.5 px-1 pb-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        className="flex h-5 items-center justify-between rounded-md px-1.5 text-2xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span>Limits left</span>
        <ChevronDownIcon
          aria-hidden
          className={cn("size-3 transition-transform", collapsed && "-rotate-90")}
        />
      </button>
      {(collapsed ? [tightest] : entries).map((entry) => (
        <UsageStripRow key={entry.pool.driver} entry={entry} now={now} onOpen={openLimits} />
      ))}
    </section>
  );
}
