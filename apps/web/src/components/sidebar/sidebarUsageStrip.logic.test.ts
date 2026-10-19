import { ProviderDriverKind, type ServerProviderUsageWindow } from "@t3tools/contracts";
import { collectLimitPools, type LimitAccount } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import {
  compactCountdown,
  tightestUsageStripEntry,
  usageStripEntries,
  usageStripTone,
} from "./sidebarUsageStrip.logic";

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const HOUR = 3_600_000;

function window(
  id: string,
  kind: ServerProviderUsageWindow["kind"],
  usedPercent: number,
  resetsInHours?: number,
): ServerProviderUsageWindow {
  return {
    id,
    kind,
    label: id,
    usedPercent,
    ...(resetsInHours === undefined
      ? {}
      : { resetsAt: new Date(NOW + resetsInHours * HOUR).toISOString() }),
  };
}

function account(
  key: string,
  driver: string,
  windows: readonly ServerProviderUsageWindow[],
): LimitAccount {
  return {
    key,
    driver: ProviderDriverKind.make(driver),
    displayName: null,
    email: `${key}@example.com`,
    plan: undefined,
    accentColor: undefined,
    environments: [],
    sourceLabel: null,
    redeem: null,
    limits: { checkedAt: new Date(NOW).toISOString(), windows: [...windows] },
  };
}

describe("usageStripEntries", () => {
  it("shows each provider's window closest to running out", () => {
    const entries = usageStripEntries(
      collectLimitPools(
        [
          account("claude", "claudeAgent", [
            window("five_hour", "session", 76, 2),
            window("seven_day", "weekly", 29, 72),
          ]),
          account("codex", "codex", [window("primary", "weekly", 18, 96)]),
          account("cursor", "cursor", [window("totalPercentUsed", "monthly", 93, 48)]),
        ],
        NOW,
      ),
    );

    expect(
      entries.map((entry) => [
        entry.pool.driver,
        entry.tightest.label,
        entry.tightest.remainingPercent,
        usageStripTone(entry.tightest.remainingPercent),
      ]),
    ).toEqual([
      ["claudeAgent", "five_hour", 24, "low"],
      ["codex", "primary", 82, "ok"],
      ["cursor", "totalPercentUsed", 7, "out"],
    ]);
    expect(entries[0]!.windows).toHaveLength(2);
    expect(entries[0]!.resetAt).toBe(NOW + 2 * HOUR);
    expect(tightestUsageStripEntry(entries)?.pool.driver).toBe("cursor");
  });

  it("pools several accounts into one row and counts down to the reset that refills", () => {
    const [entry] = usageStripEntries(
      collectLimitPools(
        [
          account("a", "claudeAgent", [window("five_hour", "session", 0, 1)]),
          account("b", "claudeAgent", [window("five_hour", "session", 100, 3)]),
        ],
        NOW,
      ),
    );

    expect(entry!.tightest.remainingPercent).toBe(50);
    // Account a's reset restores nothing, so the countdown is to b's.
    expect(entry!.resetAt).toBe(NOW + 3 * HOUR);
  });

  it("leaves out providers that report no windows", () => {
    expect(usageStripEntries(collectLimitPools([account("x", "grok", [])], NOW))).toEqual([]);
    expect(tightestUsageStripEntry([])).toBeNull();
  });
});

describe("compactCountdown", () => {
  it("rounds down to the largest unit", () => {
    expect(compactCountdown(NOW + 3 * 24 * HOUR + 5 * HOUR, NOW)).toBe("3d");
    expect(compactCountdown(NOW + 1.9 * HOUR, NOW)).toBe("1h");
    expect(compactCountdown(NOW + 20_000, NOW)).toBe("1m");
    expect(compactCountdown(NOW - 1, NOW)).toBe("now");
  });
});
