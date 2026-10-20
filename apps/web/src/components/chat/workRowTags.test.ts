import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { reasoningDuration, toolFailureTag } from "./workRowTags";

// Only the fields the tags read; the rest of a turn item is irrelevant here.
const item = (fields: Record<string, unknown>) => fields as unknown as OrchestrationV2TurnItem;
const at = (iso: string) => DateTime.makeUnsafe(iso);

describe("toolFailureTag", () => {
  it("says a call that never ran was blocked or cancelled, and anything else failed", () => {
    expect(toolFailureTag(item({ toolNonExecutionKind: "permission-rule" }))).toBe("Blocked");
    expect(toolFailureTag(item({ toolNonExecutionKind: "cancelled" }))).toBe("Cancelled");
    expect(toolFailureTag(item({ toolNonExecutionKind: "sandbox" }))).toBe("Didn't run");
    expect(toolFailureTag(item({}))).toBe("Failed");
    expect(toolFailureTag(undefined)).toBe("Failed");
  });
});

describe("reasoningDuration", () => {
  const thought = (status: string, end: string | null) =>
    item({
      type: "reasoning",
      status,
      startedAt: at("2026-10-20T09:04:47.000Z"),
      completedAt: end === null ? null : at(end),
    });

  it("shows how long a finished thought took", () => {
    expect(reasoningDuration(thought("completed", "2026-10-20T09:04:50.000Z"))).toBe("3s");
    expect(reasoningDuration(thought("completed", "2026-10-20T09:06:12.000Z"))).toBe("1m 25s");
  });

  it("stays quiet for running, instant, or non-reasoning items", () => {
    expect(reasoningDuration(thought("running", null))).toBeNull();
    expect(reasoningDuration(thought("completed", "2026-10-20T09:04:47.400Z"))).toBeNull();
    expect(reasoningDuration(item({ type: "dynamic_tool", status: "completed" }))).toBeNull();
  });
});
