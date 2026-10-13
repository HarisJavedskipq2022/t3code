import { FORK_THEMES } from "@t3tools/shared/forkThemes";
import type { ThemeColorRole } from "@t3tools/shared/themePalettes";
import { wcagContrast } from "culori";
import { describe, expect, it } from "vite-plus/test";

const READABLE_PAIRS: ReadonlyArray<readonly [ThemeColorRole, ThemeColorRole]> = [
  ["text", "canvas"],
  ["textMuted", "canvas"],
  ["accentForeground", "accent"],
  ["messageForeground", "messageSurface"],
  ["messageActionForeground", "messageAction"],
  ["sidebarForeground", "sidebarRowSelected"],
  ["sidebarMutedForeground", "sidebar"],
  ["errorForeground", "errorSurface"],
  ["warningForeground", "warningSurface"],
  ["updateForeground", "updateSurface"],
];

describe("fork themes", () => {
  it.each(FORK_THEMES.map((theme) => [theme.id, theme] as const))(
    "keeps %s readable in both appearances",
    (_id, theme) => {
      for (const colors of [theme.colors, theme.variants?.dark]) {
        expect(colors).toBeDefined();
        for (const [foreground, background] of READABLE_PAIRS) {
          expect(
            wcagContrast(colors![foreground], colors![background]),
            `${foreground} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(wcagContrast(colors!.placeholder, colors!.canvas)).toBeGreaterThanOrEqual(3);
      }
    },
  );
});
