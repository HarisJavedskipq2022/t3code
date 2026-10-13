import { describe, expect, it } from "@effect/vitest";
import {
  NodeId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadFusion,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { fusionTurnInstructions, threadFusionChanged } from "./Fusion.ts";

const commandCode = ProviderInstanceId.make("acpRegistry_command_code");
const fusion: OrchestrationV2ThreadFusion = {
  sidekick: {
    instanceId: commandCode,
    model: "deepseek/deepseek-v4.1-flash",
    options: [{ id: "effort", value: "high" }],
  },
};

function subagent(overrides: Partial<OrchestrationV2Subagent>): OrchestrationV2Subagent {
  const now = DateTime.makeUnsafe("2026-10-12T12:00:00Z");
  return {
    id: NodeId.make("node-sidekick"),
    threadId: ThreadId.make("thread-lead"),
    runId: null,
    parentNodeId: NodeId.make("node-lead"),
    origin: "app_owned",
    createdBy: "agent",
    driver: ProviderDriverKind.make("acpRegistry"),
    providerInstanceId: commandCode,
    providerThreadId: null,
    childThreadId: ThreadId.make("thread-sidekick"),
    nativeTaskRef: null,
    prompt: "Implement step 1",
    title: "Fusion sidekick: step 1",
    model: fusion.sidekick.model,
    modelSelection: fusion.sidekick,
    status: "completed",
    result: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("threadFusionChanged", () => {
  it("detects turning Fusion on, off, and switching the sidekick model", () => {
    const other = { sidekick: { ...fusion.sidekick, model: "kimi-k3" } };
    expect(threadFusionChanged(null, fusion)).toBe(true);
    expect(threadFusionChanged(fusion, null)).toBe(true);
    expect(threadFusionChanged(fusion, other)).toBe(true);
    expect(threadFusionChanged(fusion, { sidekick: { ...fusion.sidekick } })).toBe(false);
    expect(threadFusionChanged(null, null)).toBe(false);
  });
});

describe("fusionTurnInstructions", () => {
  it("is empty without Fusion and for compaction turns", () => {
    expect(fusionTurnInstructions({ thread: {}, subagents: [], compact: false })).toBe("");
    expect(
      fusionTurnInstructions({ thread: { fusion: null }, subagents: [], compact: false }),
    ).toBe("");
    expect(fusionTurnInstructions({ thread: { fusion }, subagents: [], compact: true })).toBe("");
  });

  it("tells a new lead to start one sidekick with the exact target", () => {
    const text = fusionTurnInstructions({ thread: { fusion }, subagents: [], compact: false });
    expect(text).toContain("<t3_fusion>");
    expect(text).toContain(
      'Sidekick target: {"providerInstanceId":"acpRegistry_command_code","model":"deepseek/deepseek-v4.1-flash","options":[{"id":"effort","value":"high"}]}',
    );
    expect(text).toContain("No sidekick exists yet");
    expect(text).toContain("overrides the general advice to call delegate_task again");
  });

  it("points a returning lead at its existing sidekick", () => {
    const text = fusionTurnInstructions({
      thread: { fusion },
      subagents: [subagent({})],
      compact: false,
    });
    expect(text).toContain("Your sidekick is thread thread-sidekick");
    expect(text).toContain("Do not start another sidekick");
    expect(text).not.toContain("No sidekick exists yet");
  });

  it("starts a fresh sidekick once the last one failed, was cancelled, or was interrupted", () => {
    for (const status of ["failed", "cancelled", "interrupted"] as const) {
      const text = fusionTurnInstructions({
        thread: { fusion },
        subagents: [subagent({ status })],
        compact: false,
      });
      expect(text).toContain("No sidekick exists yet");
    }
  });
});
