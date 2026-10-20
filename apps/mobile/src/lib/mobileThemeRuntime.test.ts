import { BUILT_IN_THEME_IDS } from "@t3tools/shared/themePalettes";
import { describe, expect, it } from "vite-plus/test";

import {
  createMobileThemeRuntimeOperations,
  getMobileUniwindThemeName,
  type MobileThemeRuntimeState,
} from "./mobileThemeRuntime";

// Uniwind's light and dark, then both halves of every built-in theme.
const THEME_NAME_COUNT = 2 + BUILT_IN_THEME_IDS.length * 2;
const LAST_THEME_NAME = `${BUILT_IN_THEME_IDS.at(-1)}-dark`;

const initialState: MobileThemeRuntimeState = {
  baseFontSize: 16,
  themeAppearance: "light",
  themeMode: "system",
};

describe("mobileThemeRuntime", () => {
  it("keeps the default palette on Uniwind's built-in appearance themes", () => {
    expect(getMobileUniwindThemeName("t3-code", "light")).toBe("light");
    expect(getMobileUniwindThemeName("t3-code", "dark")).toBe("dark");
  });

  it("maps custom palettes and appearances to registered themes", () => {
    expect(getMobileUniwindThemeName("t3-chat", "dark")).toBe("t3-chat-dark");
  });

  it("hydrates text variables and clears the native appearance override", () => {
    const operations = createMobileThemeRuntimeOperations(null, initialState);
    const variableOperations = operations.filter(
      (operation) => operation.kind === "update-text-variables",
    );

    expect(variableOperations).toHaveLength(THEME_NAME_COUNT);
    expect(variableOperations.at(-1)?.themeName).toBe(LAST_THEME_NAME);
    expect(operations.at(-1)).toEqual({
      kind: "set-appearance-mode",
      appearance: "light",
      themeMode: "system",
    });
  });

  it("lets system appearance changes flow through the root ScopedTheme only", () => {
    const operations = createMobileThemeRuntimeOperations(initialState, {
      ...initialState,
      themeAppearance: "dark",
    });

    expect(operations).toEqual([]);
  });

  it("updates native appearance once when the selected mode changes", () => {
    const operations = createMobileThemeRuntimeOperations(initialState, {
      ...initialState,
      themeAppearance: "dark",
      themeMode: "dark",
    });

    expect(operations).toEqual([
      {
        kind: "set-appearance-mode",
        appearance: "dark",
        themeMode: "dark",
      },
    ]);
  });

  it("updates text variables for every theme without switching palettes", () => {
    const operations = createMobileThemeRuntimeOperations(initialState, {
      ...initialState,
      baseFontSize: 18,
    });

    expect(operations).toHaveLength(THEME_NAME_COUNT);
    expect(operations.every((operation) => operation.kind === "update-text-variables")).toBe(true);
    expect(operations.at(-1)).toMatchObject({
      kind: "update-text-variables",
      themeName: LAST_THEME_NAME,
    });
  });

  it("does no native work when persistence echoes an already-applied state", () => {
    expect(createMobileThemeRuntimeOperations(initialState, initialState)).toEqual([]);
  });
});
