import { describe, expect, it } from "vite-plus/test";

import { resolveSplitOpenTarget } from "./splitViewStore";

const candidates = [
  { key: "env:a", updatedAt: "2026-10-19T10:00:00.000Z" },
  { key: "env:b", updatedAt: "2026-10-19T12:00:00.000Z" },
  { key: "env:c", updatedAt: "2026-10-19T11:00:00.000Z" },
];

describe("resolveSplitOpenTarget", () => {
  it("reopens the last split thread", () => {
    expect(
      resolveSplitOpenTarget({
        primaryThreadKey: "env:a",
        lastSecondaryThreadKey: "env:c",
        candidates,
      }),
    ).toBe("env:c");
  });

  it("falls back to the most recently updated other thread", () => {
    expect(
      resolveSplitOpenTarget({
        primaryThreadKey: "env:b",
        lastSecondaryThreadKey: null,
        candidates,
      }),
    ).toBe("env:c");
    // The last split thread is now the route thread, or no longer exists.
    expect(
      resolveSplitOpenTarget({
        primaryThreadKey: "env:a",
        lastSecondaryThreadKey: "env:a",
        candidates,
      }),
    ).toBe("env:b");
    expect(
      resolveSplitOpenTarget({
        primaryThreadKey: "env:a",
        lastSecondaryThreadKey: "env:gone",
        candidates,
      }),
    ).toBe("env:b");
  });

  it("opens nothing when the route thread is the only one", () => {
    expect(
      resolveSplitOpenTarget({
        primaryThreadKey: "env:a",
        lastSecondaryThreadKey: null,
        candidates: [candidates[0]!],
      }),
    ).toBeNull();
  });
});
