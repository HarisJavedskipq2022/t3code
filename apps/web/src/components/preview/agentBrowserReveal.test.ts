import { describe, expect, it } from "vite-plus/test";

import { agentBrowserRevealTarget } from "./agentBrowserReveal";

const reveal = (overrides: Partial<Parameters<typeof agentBrowserRevealTarget>[0]>) =>
  agentBrowserRevealTarget({
    inPanel: false,
    forced: false,
    autoShowFloatingPreview: false,
    sheetLayout: false,
    ...overrides,
  });

describe("agentBrowserRevealTarget", () => {
  it("opens an agent's browser as a panel tab when floating previews are off", () => {
    expect(reveal({})).toBe("panel");
    expect(reveal({ forced: true })).toBe("panel");
  });

  it("floats it when floating previews are on", () => {
    expect(reveal({ autoShowFloatingPreview: true })).toBe("floating");
    expect(reveal({ autoShowFloatingPreview: true, sheetLayout: true })).toBe("floating");
  });

  it("keeps sheet layouts free of panel tabs, floating only a forced reveal", () => {
    expect(reveal({ sheetLayout: true })).toBeNull();
    expect(reveal({ sheetLayout: true, forced: true })).toBe("floating");
  });

  it("brings a tab already in the panel forward only when forced", () => {
    expect(reveal({ inPanel: true })).toBeNull();
    expect(reveal({ inPanel: true, autoShowFloatingPreview: true })).toBeNull();
    expect(reveal({ inPanel: true, forced: true })).toBe("activate");
  });
});
